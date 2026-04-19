# Parallel Claude + Redshift Processing: Implementation Guide

This document teaches how to build a high-throughput pipeline that reads records from
Redshift, processes each one with the Claude API in parallel, and writes results back —
all bounded and config-driven with zero idle threads.

---

## Architecture Overview

```
config.yaml
    │
    ▼
FeedbackProcessor.__init__()
    │  reads all tuning knobs (workers, concurrency, pool size)
    │  creates ThreadedConnectionPool (Redshift)
    │  creates threading.Semaphore (Claude rate limit)
    │  creates threading.local (per-thread Claude client)
    │
    ▼
process_continuous()          ← main loop, keeps executor always full
    │
    ├── refill_buffer()       ← pulls `prefetch` rows from Redshift into a deque
    │
    └── ThreadPoolExecutor(max_workers=N)
            │
            └── _process_one(record)   ← unit of work, runs in each thread
                    │
                    ├── process_with_ai(record)
                    │       sanitize text
                    │       format prompt
                    │       acquire Semaphore  ← throttles concurrent Claude calls
                    │       client.messages.create(...)
                    │       release Semaphore
                    │       parse JSON
                    │       retry with exponential backoff on failure
                    │
                    ├── validate_ai_response(result)
                    │
                    └── update_record(conn, record, result)
                            acquire conn from ThreadedConnectionPool
                            UPDATE ... WHERE data_source_id = ?
                            release conn back to pool
                            retry on transient DB errors
```

---

## config.yaml Structure

```yaml
anthropic:
  api_key: "sk-ant-..."          # your Anthropic API key
  model: "claude-opus-4-5"        # model to use
  max_tokens: 4000
  temperature: 0.1                # low = consistent categorization

database:
  host: "your-redshift-cluster.redshift.amazonaws.com"
  port: 5439
  database: "your_db"
  user: "your_user"
  password: "your_password"
  schema: "your_schema"
  table: "your_table"

processing:
  max_workers: 8                  # ThreadPoolExecutor threads
  claude_max_concurrency: 8       # Semaphore cap for in-flight Claude calls
  max_db_conns: 8                 # ThreadedConnectionPool maxconn
  batch_size: 8                   # legacy; used only by run_old()
  prefetch: 200                   # rows fetched from DB per refill
  sleep_between_batches: 2        # legacy; not used in continuous mode
  max_retries: 3                  # legacy alias; prefer explicit keys below
  retry_delay: 5                  # legacy alias

  # Fine-grained retry knobs (fall back to defaults if absent)
  claude_max_retries: 6           # retry attempts for Claude API errors
  claude_backoff_base: 1.0        # initial backoff seconds
  claude_backoff_cap: 30.0        # max backoff seconds
  db_max_retries: 5               # retry attempts for transient DB errors
  db_backoff_base: 0.5
  db_backoff_cap: 10.0
```

**How each key is consumed:**

| Key | Where used |
|-----|-----------|
| `max_workers` | `ThreadPoolExecutor(max_workers=...)` |
| `claude_max_concurrency` | `threading.Semaphore(...)` |
| `max_db_conns` | `ThreadedConnectionPool(maxconn=...)` |
| `prefetch` | `fetch_unprocessed_batch(limit=prefetch)` on each refill |
| `batch_size` | `fetch_unprocessed_batch(limit=batch_size)` in legacy loop |
| `claude_max_retries` | inner retry loop in `process_with_ai` |
| `claude_backoff_base/cap` | `_exp_backoff(attempt, base, cap)` for Claude |
| `db_max_retries` | inner retry loop in `update_record` |
| `db_backoff_base/cap` | `_exp_backoff(attempt, base, cap)` for DB |

---

## Dependencies

```
anthropic
psycopg2-binary
pyyaml
```

---

## Full Implementation

```python
#!/usr/bin/env python3

import re
import json
import time
import yaml
import random
import threading
import logging
import sys
from datetime import datetime
from collections import deque
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from typing import Dict, List, Optional, Tuple

from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
import anthropic


# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(threadName)s - %(message)s",
    handlers=[
        logging.FileHandler("processing.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


# ── Backoff helpers ───────────────────────────────────────────────────────────

def _exp_backoff(attempt: int, base: float, cap: float) -> float:
    """Exponential backoff: base * 2^attempt, capped at cap."""
    return min(cap, base * (2 ** attempt))

def _sleep_with_jitter(seconds: float) -> None:
    """Sleep with up to 25% random jitter to avoid thundering-herd retries."""
    time.sleep(seconds + random.uniform(0, seconds * 0.25))


# ── Response extraction helpers ───────────────────────────────────────────────

def _extract_text_from_anthropic_message(msg) -> str:
    """Handle both list-of-blocks and plain-string content formats."""
    try:
        content = getattr(msg, "content", None)
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        parts.append(block["text"])
                else:
                    t = getattr(block, "text", None)
                    if t:
                        parts.append(t)
            if parts:
                return "".join(parts)
        if isinstance(content, str):
            return content
    except Exception:
        pass
    return str(msg)

def _strip_json_fence(s: str) -> str:
    """Remove ```json ... ``` wrappers Claude sometimes adds."""
    s = (s or "").strip()
    if s.startswith("```json"):
        s = s[len("```json"):].strip()
    if s.startswith("```"):
        s = s[3:].strip()
    if s.endswith("```"):
        s = s[:-3].strip()
    return s


# ── Main processor ────────────────────────────────────────────────────────────

class ParallelProcessor:

    def __init__(self, config_path: str = "config.yaml"):
        with open(config_path) as f:
            self.config = yaml.safe_load(f)

        proc = self.config.get("processing", {})

        # Concurrency knobs
        self.max_workers           = int(proc.get("max_workers", 5))
        self.max_db_conns          = int(proc.get("max_db_conns", self.max_workers))
        self.claude_max_concurrency = int(proc.get("claude_max_concurrency", self.max_workers))

        # Retry knobs — Claude
        self.claude_max_retries   = int(proc.get("claude_max_retries", 6))
        self.claude_backoff_base  = float(proc.get("claude_backoff_base", 1.0))
        self.claude_backoff_cap   = float(proc.get("claude_backoff_cap", 30.0))

        # Retry knobs — DB
        self.db_max_retries  = int(proc.get("db_max_retries", 5))
        self.db_backoff_base = float(proc.get("db_backoff_base", 0.5))
        self.db_backoff_cap  = float(proc.get("db_backoff_cap", 10.0))

        # Thread-safety primitives
        self._claude_sem    = threading.Semaphore(self.claude_max_concurrency)
        self._counter_lock  = threading.Lock()
        self._thread_local  = threading.local()   # one Anthropic client per thread

        # State
        self.db_pool: Optional[ThreadedConnectionPool] = None
        self.processed_count = 0
        self.error_count     = 0

    # ── Anthropic client (per-thread) ────────────────────────────────────────

    def _get_anthropic_client(self) -> anthropic.Anthropic:
        """
        Create one Anthropic client per thread and reuse it.
        threading.local ensures each thread has its own instance,
        avoiding contention on a shared object.
        """
        if not hasattr(self._thread_local, "client"):
            self._thread_local.client = anthropic.Anthropic(
                api_key=self.config["anthropic"]["api_key"]
            )
        return self._thread_local.client

    # ── Database ─────────────────────────────────────────────────────────────

    def connect_db(self):
        """
        ThreadedConnectionPool is psycopg2's thread-safe pool.
        maxconn should equal max_workers so every thread can hold
        one connection without blocking.
        """
        db = self.config["database"]
        self.db_pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=self.max_db_conns,
            host=db["host"],
            port=db["port"],
            database=db["database"],
            user=db["user"],
            password=db["password"],
        )
        logger.info(f"DB pool ready (maxconn={self.max_db_conns})")

    def _get_conn(self):
        return self.db_pool.getconn()

    def _put_conn(self, conn):
        self.db_pool.putconn(conn)

    def fetch_unprocessed_batch(self, limit: int) -> List[Dict]:
        """
        Pull `limit` unprocessed rows.  Using a large `limit` (prefetch=200)
        reduces the number of DB round-trips dramatically.
        """
        conn = self._get_conn()
        try:
            schema = self.config["database"]["schema"]
            table  = self.config["database"]["table"]
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    SELECT *
                    FROM {schema}.{table}
                    WHERE ai_processed_at IS NULL
                    ORDER BY id ASC
                    LIMIT {limit};
                """)
                return cur.fetchall()
        finally:
            self._put_conn(conn)

    def count_unprocessed(self) -> int:
        conn = self._get_conn()
        try:
            schema = self.config["database"]["schema"]
            table  = self.config["database"]["table"]
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT COUNT(*) FROM {schema}.{table} WHERE ai_processed_at IS NULL;"
                )
                return int(cur.fetchone()[0])
        finally:
            self._put_conn(conn)

    # ── AI processing ─────────────────────────────────────────────────────────

    def build_prompt(self, record: Dict) -> str:
        """
        Adapt this method to your domain.
        Use self.config["prompt_template"].format(**fields) for config-driven prompts.
        """
        return self.config["prompt_template"].format(**record)

    def process_with_ai(self, record: Dict) -> Optional[Dict]:
        """
        Key design decisions:
        1. Semaphore caps concurrent in-flight Claude requests to claude_max_concurrency.
           Threads that exceed the cap block here until a slot opens — no errors, no drops.
        2. Per-thread Anthropic client avoids shared-state contention.
        3. Exponential backoff + jitter on any API exception.
        4. Returns None on permanent failure (caller decides what to write to DB).
        """
        prompt = self.build_prompt(record)
        model      = self.config["anthropic"]["model"]
        max_tokens = self.config["anthropic"]["max_tokens"]
        temperature = self.config["anthropic"]["temperature"]

        with self._claude_sem:   # ← throttle: at most claude_max_concurrency requests in flight
            for attempt in range(self.claude_max_retries + 1):
                try:
                    client = self._get_anthropic_client()
                    msg = client.messages.create(
                        model=model,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        messages=[{"role": "user", "content": prompt}],
                    )
                    raw = _strip_json_fence(_extract_text_from_anthropic_message(msg))
                    return json.loads(raw)

                except json.JSONDecodeError:
                    logger.error(f"JSON parse failed for {record.get('id')}")
                    return None   # not a transient error; don't retry

                except Exception as e:
                    if attempt >= self.claude_max_retries:
                        logger.error(f"Claude permanently failed for {record.get('id')}: {e}")
                        return None
                    backoff = _exp_backoff(attempt, self.claude_backoff_base, self.claude_backoff_cap)
                    logger.warning(f"Claude attempt {attempt+1} failed: {e} — retrying in {backoff:.1f}s")
                    _sleep_with_jitter(backoff)

        return None

    # ── DB write with retries ─────────────────────────────────────────────────

    def update_record(self, conn, record: Dict, result: Dict) -> bool:
        """
        Retries only on transient Redshift errors (serialization failures,
        deadlocks, lock timeouts, connection resets).
        Permanent errors are not retried.
        """
        schema = self.config["database"]["schema"]
        table  = self.config["database"]["table"]

        # Adapt SET clause to your column names
        sql = f"""
            UPDATE {schema}.{table}
            SET
                ai_result        = %s,
                ai_processed_at  = %s,
                ai_model         = %s
            WHERE id = %s;
        """
        params = (
            json.dumps(result),
            datetime.now(),
            self.config["anthropic"]["model"],
            record["id"],
        )

        for attempt in range(self.db_max_retries + 1):
            try:
                with conn.cursor() as cur:
                    cur.execute(sql, params)
                conn.commit()
                return True
            except Exception as e:
                conn.rollback()
                msg = str(e).lower()
                transient = isinstance(e, (
                    pg_errors.SerializationFailure,
                    pg_errors.DeadlockDetected,
                    pg_errors.LockNotAvailable,
                )) or any(k in msg for k in [
                    "serializ", "deadlock", "lock", "concurrent update",
                    "timeout", "connection reset", "terminating connection",
                ])

                if not transient or attempt >= self.db_max_retries:
                    logger.error(f"DB update failed for {record.get('id')}: {e}")
                    return False

                backoff = _exp_backoff(attempt, self.db_backoff_base, self.db_backoff_cap)
                logger.warning(f"DB transient error attempt {attempt+1}: {e} — retrying in {backoff:.1f}s")
                _sleep_with_jitter(backoff)

        return False

    # ── Single unit of work (runs inside each thread) ─────────────────────────

    def _process_one(self, record: Dict) -> Tuple[bool, str]:
        """
        This function is what each worker thread executes.
        It is completely self-contained:
        - calls Claude (throttled via semaphore)
        - grabs its own DB connection from the pool
        - writes the result
        - returns the connection to the pool
        """
        rid = record.get("id")
        try:
            result = self.process_with_ai(record)
            if result is None:
                return False, "ai_failed"

            conn = self._get_conn()
            try:
                ok = self.update_record(conn, record, result)
            finally:
                self._put_conn(conn)   # always return the connection

            return (True, "ok") if ok else (False, "db_failed")
        except Exception as e:
            logger.error(f"Unexpected error for record {rid}: {e}")
            return False, "unexpected"

    # ── Main continuous loop ──────────────────────────────────────────────────

    def process_continuous(self):
        """
        The executor is kept always full: as soon as one future completes,
        a new one is submitted from the buffer, keeping all workers busy.

        Buffer design:
        - `prefetch` rows are pulled from DB at once to minimise round-trips.
        - The buffer is a deque; refill only happens when it drops to 0.
        - FIRST_COMPLETED lets us react immediately when any worker finishes.
        """
        proc    = self.config.get("processing", {})
        prefetch = int(proc.get("prefetch", max(50, self.max_workers * 5)))

        buffer: deque = deque()

        def refill_buffer():
            if len(buffer) == 0:
                rows = self.fetch_unprocessed_batch(prefetch)
                buffer.extend(rows)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = set()

            # Initial fill
            refill_buffer()
            while buffer and len(futures) < self.max_workers:
                futures.add(executor.submit(self._process_one, buffer.popleft()))

            # Reactive loop
            while futures:
                done, not_done = wait(futures, return_when=FIRST_COMPLETED)
                futures = not_done

                for f in done:
                    ok, status = f.result()
                    with self._counter_lock:
                        if ok:
                            self.processed_count += 1
                        else:
                            self.error_count += 1
                    if not ok:
                        logger.warning(f"Record failed: {status}")

                # Refill buffer if exhausted, then top up the executor
                refill_buffer()
                while buffer and len(futures) < self.max_workers:
                    futures.add(executor.submit(self._process_one, buffer.popleft()))

    # ── Entry point ───────────────────────────────────────────────────────────

    def run(self):
        self.connect_db()

        total = self.count_unprocessed()
        logger.info(f"Records to process: {total}")

        self.process_continuous()

        self.db_pool.closeall()
        logger.info(
            f"Done. processed={self.processed_count}  errors={self.error_count}"
        )


def main():
    processor = ParallelProcessor()
    try:
        processor.run()
    except KeyboardInterrupt:
        logger.info("Interrupted")
    except Exception as e:
        logger.error(f"Fatal: {e}")
        raise


if __name__ == "__main__":
    main()
```

---

## How the Three Concurrency Controls Work Together

### 1. `ThreadPoolExecutor(max_workers=N)`
Creates a fixed thread pool. Every call to `executor.submit(fn, arg)` queues a task.
The `N` active threads run tasks concurrently; extras wait in the queue.

```python
# All 8 slots are kept filled at all times
with ThreadPoolExecutor(max_workers=8) as executor:
    ...
```

### 2. `threading.Semaphore(M)` — Claude rate-limit guard
A semaphore with count M means at most M threads can be inside the `with self._claude_sem`
block simultaneously. Threads that try to acquire when the count is 0 block until another
thread releases.

```python
self._claude_sem = threading.Semaphore(8)

# In process_with_ai:
with self._claude_sem:          # blocks if 8 calls already in flight
    msg = client.messages.create(...)
```

Set `claude_max_concurrency < max_workers` if you want threads doing DB work while
fewer threads call Claude (e.g., max_workers=16, claude_max_concurrency=8).

### 3. `ThreadedConnectionPool(maxconn=K)` — DB connection reuse
psycopg2's thread-safe pool. `getconn()` hands out a connection; `putconn()` returns it.
If all K connections are checked out, `getconn()` raises `PoolError` — set K ≥ max_workers
to avoid this.

```python
conn = self._get_conn()
try:
    ...                  # use the connection
finally:
    self._put_conn(conn) # ALWAYS return in finally block
```

### 4. `threading.local()` — per-thread Anthropic client
The Anthropic SDK client is not explicitly documented as thread-safe. Using
`threading.local()` gives each thread its own client instance, eliminating any
potential shared-state bugs with no synchronization overhead.

```python
self._thread_local = threading.local()

def _get_anthropic_client(self):
    if not hasattr(self._thread_local, "client"):
        self._thread_local.client = anthropic.Anthropic(api_key=...)
    return self._thread_local.client
```

---

## Buffer + FIRST_COMPLETED: Why This Pattern

The naive approach is to fetch a batch, wait for ALL to finish, fetch the next batch.
This leaves threads idle while the slowest record in each batch finishes.

This project uses a different pattern:

```
FIRST_COMPLETED pattern
─────────────────────────────────────────────────────
buffer: [r1, r2, r3, ...r200]

t=0   submit r1..r8 to executor (fills all 8 slots)
t=1   r3 finishes first  → immediately submit r9
t=2   r1 finishes        → immediately submit r10
...   (workers never sit idle)
t=X   buffer drops to 0  → fetch next 200 from DB
```

The key lines:
```python
done, not_done = wait(futures, return_when=FIRST_COMPLETED)
# React to each completion immediately instead of waiting for the whole batch
```

---

## Retry Strategy

Both Claude and DB retries use the same pattern:

```
attempt 0  → fail → sleep 1s  (base=1.0, 2^0=1)
attempt 1  → fail → sleep 2s  (2^1=2)
attempt 2  → fail → sleep 4s
attempt 3  → fail → sleep 8s
attempt 4  → fail → sleep 16s
attempt 5  → fail → sleep 30s (capped)
attempt 6  → permanent failure → return None
```

Jitter (0–25% of the sleep time) is added to each sleep to prevent multiple threads
from all retrying at the exact same moment ("thundering herd").

---

## Adapting This to a New Project

1. **Copy `config.yaml`** — change credentials, model, and `processing.*` knobs.
2. **Rename `fetch_unprocessed_batch`** — change the SELECT query to match your table/columns.
   The only contract: return `List[Dict]` where each dict is one record.
3. **Rename `update_record`** — change the UPDATE query and params to match your schema.
4. **Rename `build_prompt`** — replace with your domain's prompt logic.
5. **Rename `validate_ai_response`** (optional) — add domain-specific validation of Claude's JSON.
6. `_process_one`, `process_continuous`, `connect_db`, and all retry/backoff helpers
   are **generic and can be copied verbatim**.

The invariant to preserve:
- `_process_one` must call `_put_conn` in a `finally` block — leaked connections exhaust the pool.
- `_process_one` must not raise — wrap everything in try/except and return `(False, reason)`.
- `process_continuous` assumes `fetch_unprocessed_batch` returns `[]` when there is nothing left.

---

## Tuning Recommendations

| Scenario | Adjustment |
|----------|-----------|
| Claude rate-limit errors (429) | Decrease `claude_max_concurrency` |
| Idle DB connections | Set `max_db_conns = max_workers` (already default) |
| Slow throughput | Increase `max_workers` and `claude_max_concurrency` together |
| High memory use | Decrease `prefetch` |
| Too many DB round-trips | Increase `prefetch` |
| Flaky Redshift connection | Increase `db_max_retries`, increase `db_backoff_cap` |
| Claude overloaded errors | Increase `claude_backoff_cap`, increase `claude_max_retries` |

A balanced starting point for most workloads:
```yaml
max_workers: 8
claude_max_concurrency: 8
max_db_conns: 8
prefetch: 200
```
