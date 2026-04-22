import time
import random
import threading
import logging
import psycopg2
from psycopg2 import errors as pg_errors
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
from contextlib import contextmanager
from shared import config

logger = logging.getLogger(__name__)

# ── Simple per-call connection (used by API routes) ───────────────────────────

_CONNECT_KWARGS = dict(
    sslmode="require",
    keepalives=1,
    keepalives_idle=30,       # send keepalive after 30s idle
    keepalives_interval=5,    # retry every 5s
    keepalives_count=5,       # drop after 5 failed probes
    connect_timeout=10,
)


_TRANSIENT_CONNECT_ERRORS = (
    "server closed", "connection refused", "broken pipe",
    "could not connect", "server terminated", "timeout",
    "connection reset", "terminating connection",
)


def _open_connection():
    """Open a single psycopg2 connection with retry on transient errors."""
    last_err = None
    for attempt in range(4):
        try:
            return psycopg2.connect(
                host=config.REDSHIFT_HOST,
                port=config.REDSHIFT_PORT,
                dbname=config.REDSHIFT_DB,
                user=config.REDSHIFT_USER,
                password=config.REDSHIFT_PASSWORD,
                **_CONNECT_KWARGS,
            )
        except psycopg2.OperationalError as e:
            last_err = e
            msg = str(e).lower()
            if any(k in msg for k in _TRANSIENT_CONNECT_ERRORS) and attempt < 3:
                wait = exp_backoff(attempt, 0.5, 5.0)
                logger.warning("Redshift connect attempt %d failed: %s — retrying in %.1fs", attempt + 1, e, wait)
                sleep_with_jitter(wait)
            else:
                raise
    raise last_err  # type: ignore[misc]


@contextmanager
def get_connection():
    conn = _open_connection()
    try:
        yield conn
    finally:
        conn.close()


# ── ThreadedConnectionPool (used by parallel pipeline) ───────────────────────

_pool: ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    minconn=1,
                    maxconn=config.MAX_DB_CONNS,
                    host=config.REDSHIFT_HOST,
                    port=config.REDSHIFT_PORT,
                    dbname=config.REDSHIFT_DB,
                    user=config.REDSHIFT_USER,
                    password=config.REDSHIFT_PASSWORD,
                    **_CONNECT_KWARGS,
                )
                logger.info("Redshift connection pool ready (maxconn=%d)", config.MAX_DB_CONNS)
    return _pool


@contextmanager
def get_pooled_connection():
    """Thread-safe pooled connection. Always returns connection to pool in finally."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


# ── Backoff helpers ───────────────────────────────────────────────────────────

def exp_backoff(attempt: int, base: float, cap: float) -> float:
    return min(cap, base * (2 ** attempt))


def sleep_with_jitter(seconds: float) -> None:
    time.sleep(seconds + random.uniform(0, seconds * 0.25))


# ── DB write with transient-error retry (for use in threads) ─────────────────

def execute_with_retry(conn, query: str, params=None) -> bool:
    """Execute a query on an existing connection, retrying on transient Redshift errors."""
    for attempt in range(config.DB_MAX_RETRIES + 1):
        try:
            with conn.cursor() as cur:
                cur.execute(query, params)
            conn.commit()
            return True
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            msg = str(e).lower()
            transient = isinstance(e, (
                pg_errors.SerializationFailure,
                pg_errors.DeadlockDetected,
                pg_errors.LockNotAvailable,
            )) or any(k in msg for k in [
                "serializ", "deadlock", "lock", "concurrent update",
                "timeout", "connection reset", "terminating connection",
                "server closed", "broken pipe", "could not connect",
                "connection refused", "server terminated",
            ])
            if not transient or attempt >= config.DB_MAX_RETRIES:
                logger.error("DB execute failed: %s", e)
                return False
            backoff = exp_backoff(attempt, config.DB_BACKOFF_BASE, config.DB_BACKOFF_CAP)
            logger.warning("DB transient error (attempt %d): %s — retrying in %.1fs", attempt + 1, e, backoff)
            sleep_with_jitter(backoff)
    return False


# ── Convenience helpers ───────────────────────────────────────────────────────
# All four functions use the shared pool so connections are reused across
# requests rather than opened and closed on every call.

def fetch_all(query: str, params=None) -> list[dict]:
    with get_pooled_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            return [dict(row) for row in cur.fetchall()]


def fetch_one(query: str, params=None) -> dict | None:
    with get_pooled_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            row = cur.fetchone()
            return dict(row) if row else None


def execute(query: str, params=None) -> None:
    with get_pooled_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(query, params)
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise


def execute_returning_id(query: str, params=None) -> int | None:
    with get_pooled_connection() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(query, params)
                row = cur.fetchone()
            conn.commit()
            return row[0] if row else None
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
