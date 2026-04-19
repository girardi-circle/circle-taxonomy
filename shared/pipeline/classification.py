"""
Step 2 — Classification pipeline.

Reads pending classified_issues, embeds segment_description via Weaviate,
routes through confidence bands, and either assigns an existing subtopic or
proposes a new one as an emerging_candidate.
"""

import json
import logging
from typing import Optional

from shared import config
from shared.services.anthropic import call_claude
from shared.services.redshift import fetch_all, fetch_one, execute
from shared.services import weaviate as weaviate_service
from shared.prompts.validation import build_arbitration_prompt
from shared.prompts.new_subtopic import build_new_subtopic_prompt
from shared.lib.clustering import cluster_by_proposal
from shared.pipeline.extraction import _emit, _strip_fences

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _fetch_pending_issues(filters: Optional[dict], limit: Optional[int]) -> list[dict]:
    """
    SELECT pending classified_issues with nature/intent names joined.
    Supports optional filters: nature_ids, intent_ids, sentiments, source_types,
    timeframe_start, timeframe_end.
    """
    conditions = ["ci.classification_status = 'pending'"]
    params: list = []

    if filters:
        nature_ids = filters.get("nature_ids")
        if nature_ids:
            placeholders = ",".join(["%s"] * len(nature_ids))
            conditions.append(f"ci.nature_id IN ({placeholders})")
            params.extend(nature_ids)

        intent_ids = filters.get("intent_ids")
        if intent_ids:
            placeholders = ",".join(["%s"] * len(intent_ids))
            conditions.append(f"ci.intent_id IN ({placeholders})")
            params.extend(intent_ids)

        sentiments = filters.get("sentiments")
        if sentiments:
            placeholders = ",".join(["%s"] * len(sentiments))
            conditions.append(f"ci.sentiment IN ({placeholders})")
            params.extend(sentiments)

        source_types = filters.get("source_types")
        if source_types:
            placeholders = ",".join(["%s"] * len(source_types))
            conditions.append(f"t.source_type IN ({placeholders})")
            params.extend(source_types)

        timeframe_start = filters.get("timeframe_start")
        if timeframe_start:
            conditions.append("ci.classified_at >= %s")
            params.append(timeframe_start)

        timeframe_end = filters.get("timeframe_end")
        if timeframe_end:
            conditions.append("ci.classified_at <= %s")
            params.append(timeframe_end)

    where = "WHERE " + " AND ".join(conditions)
    limit_clause = f"LIMIT {int(limit)}" if limit else f"LIMIT {config.CLASSIFICATION_BATCH_LIMIT}"

    query = f"""
        SELECT
            ci.id,
            ci.segment_description,
            ci.sentiment,
            ci.transcript_id,
            ci.nature_id,
            ci.intent_id,
            n.name AS nature,
            i.name AS intent
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        LEFT JOIN taxonomy.transcripts t ON ci.transcript_id = t.id
        {where}
        {limit_clause}
    """
    return fetch_all(query, params or None)


def _link_issue_to_candidate(issue_id: int, candidate_id: int) -> None:
    """Append an issue to an existing emerging_candidate instead of creating a duplicate."""
    candidate = fetch_one(
        "SELECT issue_ids, cluster_size FROM taxonomy.emerging_candidates WHERE id = %s",
        (candidate_id,),
    )
    if not candidate:
        logger.warning("_link_issue_to_candidate: candidate %s not found", candidate_id)
        return

    existing_ids = candidate.get("issue_ids") or ""
    existing_list = [x.strip() for x in existing_ids.split(",") if x.strip()]
    if str(issue_id) not in existing_list:
        existing_list.append(str(issue_id))

    execute(
        """UPDATE taxonomy.emerging_candidates
           SET issue_ids = %s, cluster_size = %s
           WHERE id = %s""",
        (",".join(existing_list), len(existing_list), candidate_id),
    )
    execute(
        "UPDATE taxonomy.classified_issues SET classification_status = 'under_review' WHERE id = %s",
        (issue_id,),
    )
    logger.info("Linked issue %s to existing candidate %s (cluster_size=%d)", issue_id, candidate_id, len(existing_list))


def _create_single_candidate(issue: dict, proposal: dict) -> int | None:
    """Create an emerging_candidate immediately (not batched) and insert into Weaviate as pending.
    Returns the new candidate_id so subsequent issues in the same batch can find it."""
    topic_name = proposal.get("topic_name") or proposal.get("topic_name") or "Unknown"
    subtopic_name = proposal.get("suggested_subtopic_name") or "Uncategorized"
    canonical_description = proposal.get("canonical_description") or ""
    product_area_name = proposal.get("product_area") or ""

    product_area_id = None
    if product_area_name:
        pa_row = fetch_one(
            "SELECT id FROM taxonomy.product_areas WHERE LOWER(name) = LOWER(%s)",
            (product_area_name,),
        )
        if pa_row:
            product_area_id = pa_row["id"]

    execute(
        """INSERT INTO taxonomy.emerging_candidates
           (issue_ids, suggested_topic_name, suggested_subtopic_name,
            suggested_product_area_id, canonical_description, cluster_size, avg_similarity, status)
           VALUES (%s, %s, %s, %s, %s, 1, 0.0, 'pending')""",
        (str(issue["id"]), topic_name, subtopic_name, product_area_id, canonical_description),
    )
    row = fetch_one(
        "SELECT MAX(id) AS id FROM taxonomy.emerging_candidates WHERE suggested_subtopic_name = %s",
        (subtopic_name,),
    )
    candidate_id = row["id"] if row else None

    if candidate_id:
        execute(
            "UPDATE taxonomy.classified_issues SET classification_status = 'under_review' WHERE id = %s",
            (issue["id"],),
        )
        # Insert into Weaviate SubTopic as pending so future issues can find it
        try:
            weaviate_service.upsert_subtopic(
                subtopic_id=0,
                topic_id=0,
                product_area_id=product_area_id,
                name=subtopic_name,
                canonical_description=canonical_description,
                status="pending",
                candidate_id=candidate_id,
            )
        except Exception as e:
            logger.warning("Failed to insert pending candidate %s into Weaviate: %s", candidate_id, e)

    return candidate_id


def _load_topics() -> list[dict]:
    """Load all active topics with their product area names."""
    return fetch_all(
        """
        SELECT
            t.id,
            t.name,
            t.description,
            t.product_area_id,
            pa.name AS product_area_name
        FROM taxonomy.topics t
        LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
        WHERE t.is_active = TRUE
        ORDER BY t.name
        """
    )


def _get_subtopic_context(subtopic_id: int) -> Optional[dict]:
    """Get topic_id and product_area_id for a subtopic."""
    return fetch_one(
        """
        SELECT
            st.topic_id,
            t.product_area_id
        FROM taxonomy.sub_topics st
        JOIN taxonomy.topics t ON st.topic_id = t.id
        WHERE st.id = %s
        """,
        (subtopic_id,),
    )


def _assign_subtopic(
    issue_id: int,
    subtopic_id: int,
    confidence_score: float,
    match_method: str,
) -> None:
    """
    Mark an issue as matched:
    - UPDATE classified_issues (status=matched, sub_topic_id, confidence_score, match_method)
    - UPDATE sub_topics match_count+1
    - Sync to Weaviate
    """
    context = _get_subtopic_context(subtopic_id)
    topic_id = context["topic_id"] if context else 0
    product_area_id = context["product_area_id"] if context else None

    execute(
        """
        UPDATE taxonomy.classified_issues
        SET
            sub_topic_id = %s,
            confidence_score = %s,
            match_method = %s,
            classification_status = 'matched',
            classified_at = GETDATE()
        WHERE id = %s
        """,
        (subtopic_id, confidence_score, match_method, issue_id),
    )

    execute(
        "UPDATE taxonomy.sub_topics SET match_count = match_count + 1 WHERE id = %s",
        (subtopic_id,),
    )

    try:
        weaviate_service.update_classified_issue_subtopic(
            issue_id=issue_id,
            sub_topic_id=subtopic_id,
            topic_id=topic_id,
            product_area_id=product_area_id,
        )
    except Exception as e:
        logger.warning("Weaviate update failed for issue %s: %s", issue_id, e)


def _call_arbitration(issue: dict, candidates: list[dict]) -> tuple[dict, str, str, str, dict]:
    """
    Call Claude Prompt 2 for Band B arbitration.
    Returns (result, system_prompt, user_prompt, response_raw, usage).
    result is {"matched": false} on any error.
    """
    system, user = build_arbitration_prompt(
        segment_description=issue["segment_description"],
        nature=issue["nature"],
        intent=issue["intent"],
        candidates=candidates,
    )
    try:
        text, usage = call_claude(
            system=system,
            user=user,
            model=config.MODEL_ARBITRATION,
            temperature=0.0,
            max_tokens=256,
        )
        result = json.loads(_strip_fences(text))
        return result, system, user, text, usage
    except Exception as e:
        logger.warning("Arbitration call failed for issue %s: %s", issue["id"], e)
        return {"matched": False, "rationale": f"arbitration_error: {e}"}, system, user, "", {}


def _call_new_subtopic(
    issue: dict,
    topics: list[dict],
) -> tuple[dict, str, str, str, dict]:
    """
    Call Claude Prompt 3 for new subtopic proposal.
    Returns (result, system_prompt, user_prompt, response_raw, usage).
    """
    system, user = build_new_subtopic_prompt(
        segment_description=issue["segment_description"],
        nature=issue["nature"],
        intent=issue["intent"],
        topics=topics,
    )
    try:
        text, usage = call_claude(
            system=system,
            user=user,
            model=config.MODEL_NEW_SUBTOPIC,
            max_tokens=512,
        )
        result = json.loads(_strip_fences(text))
        return result, system, user, text, usage
    except Exception as e:
        logger.warning("New subtopic call failed for issue %s: %s", issue["id"], e)
        fallback = {
            "existing_topic": False, "topic_id": None, "topic_name": "Unknown",
            "topic_description": "", "product_area": "",
            "suggested_subtopic_name": "Uncategorized",
            "canonical_description": issue.get("segment_description", ""),
            "rationale": f"proposal_error: {e}",
        }
        return fallback, system, user, "", {}


def _write_classification_log(
    issue_id: int,
    band: str,
    decision: str,
    matched_subtopic_id: int | None = None,
    matched_subtopic_name: str | None = None,
    confidence_score: float | None = None,
    weaviate_candidates: list | None = None,
    prompt_used: str | None = None,
    claude_response: str | None = None,
    model_used: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost_usd: float | None = None,
    auto_create: bool = False,
    error_message: str | None = None,
) -> None:
    try:
        candidates_json = json.dumps(weaviate_candidates) if weaviate_candidates else None
        execute(
            """INSERT INTO taxonomy.classification_logs
               (issue_id, band, decision, matched_subtopic_id, matched_subtopic_name,
                confidence_score, weaviate_candidates, prompt_used, claude_response,
                model_used, input_tokens, output_tokens, cost_usd, auto_create, error_message)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                issue_id, band, decision, matched_subtopic_id, matched_subtopic_name,
                confidence_score, candidates_json, prompt_used, claude_response,
                model_used, input_tokens, output_tokens, cost_usd, auto_create, error_message,
            ),
        )
    except Exception as e:
        logger.error("Failed to write classification log for issue %s: %s", issue_id, e)


def _get_or_create_topic(
    topic_name: str,
    topic_description: str,
    product_area_name: str,
) -> int:
    """Get existing topic by name or create a new one. Returns topic_id."""
    existing = fetch_one(
        "SELECT id FROM taxonomy.topics WHERE LOWER(name) = LOWER(%s)",
        (topic_name,),
    )
    if existing:
        return existing["id"]

    # Resolve product_area_id
    product_area_id = None
    if product_area_name:
        pa_row = fetch_one(
            "SELECT id FROM taxonomy.product_areas WHERE LOWER(name) = LOWER(%s)",
            (product_area_name,),
        )
        if pa_row:
            product_area_id = pa_row["id"]

    execute(
        "INSERT INTO taxonomy.topics (name, description, product_area_id) VALUES (%s, %s, %s)",
        (topic_name, topic_description or "", product_area_id),
    )
    row = fetch_one(
        "SELECT MAX(id) AS id FROM taxonomy.topics WHERE LOWER(name) = LOWER(%s)",
        (topic_name,),
    )
    topic_id = row["id"] if row else None
    logger.info("Created new topic: %s (id=%s)", topic_name, topic_id)
    return topic_id


def _create_topic_subtopic(
    proposal: dict,
    topics: list[dict],
) -> tuple[int, int, bool]:
    """
    Creates topic (if new) and subtopic in Redshift and Weaviate.
    Returns (topic_id, subtopic_id, is_new_topic).
    """
    is_new_topic = False

    if proposal.get("existing_topic") and proposal.get("topic_id"):
        topic_id = proposal["topic_id"]
        # Find product_area_id from existing topics list
        topic_row = next((t for t in topics if t["id"] == topic_id), None)
        product_area_id = topic_row["product_area_id"] if topic_row else None
        product_area_name = topic_row.get("product_area_name", "") if topic_row else ""
    else:
        is_new_topic = True
        topic_name = proposal.get("topic_name") or "Unknown"
        topic_description = proposal.get("topic_description") or ""
        product_area_name = proposal.get("product_area") or ""
        topic_id = _get_or_create_topic(topic_name, topic_description, product_area_name)

        # Resolve product_area_id
        product_area_id = None
        if product_area_name:
            pa_row = fetch_one(
                "SELECT id FROM taxonomy.product_areas WHERE LOWER(name) = LOWER(%s)",
                (product_area_name,),
            )
            if pa_row:
                product_area_id = pa_row["id"]

    subtopic_name = proposal.get("suggested_subtopic_name") or "Uncategorized"
    canonical_description = proposal.get("canonical_description") or ""

    execute(
        "INSERT INTO taxonomy.sub_topics (topic_id, name, canonical_description) VALUES (%s, %s, %s)",
        (topic_id, subtopic_name, canonical_description),
    )
    row = fetch_one(
        "SELECT MAX(id) AS id FROM taxonomy.sub_topics WHERE topic_id = %s AND name = %s",
        (topic_id, subtopic_name),
    )
    subtopic_id = row["id"] if row else None
    logger.info("Created new subtopic: %s (id=%s) under topic %s", subtopic_name, subtopic_id, topic_id)

    try:
        weaviate_service.upsert_subtopic(
            subtopic_id=subtopic_id,
            topic_id=topic_id,
            product_area_id=product_area_id,
            name=subtopic_name,
            canonical_description=canonical_description,
        )
    except Exception as e:
        logger.warning("Weaviate upsert for new subtopic %s failed: %s", subtopic_id, e)

    return topic_id, subtopic_id, is_new_topic


def _create_emerging_candidates(clusters: list[dict]) -> int:
    """INSERT emerging_candidate rows from cluster list. Returns count created."""
    count = 0
    for cluster in clusters:
        if not cluster.get("issue_ids"):
            continue

        issue_ids_str = ",".join(str(i) for i in cluster["issue_ids"])
        proposal = cluster.get("representative_proposal") or {}
        product_area_name = proposal.get("product_area") or ""

        suggested_product_area_id = None
        if product_area_name:
            pa_row = fetch_one(
                "SELECT id FROM taxonomy.product_areas WHERE LOWER(name) = LOWER(%s)",
                (product_area_name,),
            )
            if pa_row:
                suggested_product_area_id = pa_row["id"]

        try:
            execute(
                """
                INSERT INTO taxonomy.emerging_candidates
                    (issue_ids, suggested_topic_name, suggested_subtopic_name,
                     suggested_product_area_id, canonical_description, cluster_size, avg_similarity, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
                """,
                (
                    issue_ids_str,
                    cluster.get("suggested_topic_name") or "",
                    cluster.get("suggested_subtopic_name") or "",
                    suggested_product_area_id,
                    cluster.get("canonical_description") or "",
                    cluster.get("cluster_size") or len(cluster["issue_ids"]),
                    0.0,  # avg_similarity placeholder — no pairwise embedding distances in Phase 2a
                ),
            )
            # Mark issues as under_review
            placeholders = ",".join(["%s"] * len(cluster["issue_ids"]))
            execute(
                f"""
                UPDATE taxonomy.classified_issues
                SET classification_status = 'under_review'
                WHERE id IN ({placeholders})
                """,
                cluster["issue_ids"],
            )
            count += 1
        except Exception as e:
            logger.error("Failed to create emerging candidate for cluster %s: %s",
                         cluster.get("suggested_subtopic_name"), e)

    return count


# ---------------------------------------------------------------------------
# Public pipeline functions
# ---------------------------------------------------------------------------

def stream_classification(
    filters: Optional[dict] = None,
    auto_create: bool = False,
    limit: Optional[int] = None,
):
    """
    SSE generator for the classification pipeline.
    Yields event dicts. Emits: classify_start, issue_start, issue_matched,
    issue_created (auto_create), issue_unmatched, candidate_created, classify_done.
    """
    issues = _fetch_pending_issues(filters, limit)
    total = len(issues)

    yield _emit({"type": "classify_start", "total": total, "auto_create": auto_create})

    if total == 0:
        yield _emit({"type": "classify_done", "matched": 0, "created": 0, "unmatched": 0, "errors": 0})
        return

    topics = _load_topics()

    matched = 0
    created = 0
    unmatched_count = 0
    candidates_created = 0
    errors = 0

    for idx, issue in enumerate(issues, 1):
        issue_meta = {
            "issue_id": issue["id"],
            "index": idx,
            "total": total,
            "segment_description": issue.get("segment_description", "")[:100],
        }
        yield _emit({"type": "issue_start", **issue_meta})

        try:
            # Search Weaviate for nearest subtopics
            candidates = weaviate_service.search_subtopics(
                segment_description=issue["segment_description"],
                limit=5,
            )

            band = None
            assigned = False

            if candidates:
                top_distance = candidates[0]["distance"]
                top = candidates[0]
                is_pending_match = top.get("status") == "pending"

                if top_distance < config.BAND_A_CEILING:
                    band = "A"
                    confidence = round(1 - top_distance, 4)

                    if is_pending_match:
                        # Band A — link to existing pending candidate
                        cand_id = top["candidate_id"]
                        _link_issue_to_candidate(issue["id"], cand_id)
                        matched += 1
                        assigned = True
                        _write_classification_log(
                            issue_id=issue["id"], band="A", decision="linked_to_candidate",
                            matched_subtopic_name=top.get("name"),
                            confidence_score=confidence, weaviate_candidates=candidates,
                            auto_create=auto_create,
                        )
                        yield _emit({
                            "type": "issue_unmatched", "band": band,
                            "proposed_subtopic": top.get("name"),
                            "proposed_topic": top.get("name"),
                            "linked_to_candidate": cand_id, **issue_meta,
                        })
                    else:
                        # Band A — auto-assign to approved subtopic
                        _assign_subtopic(issue["id"], top["subtopic_id"], confidence, "vector_direct")
                        matched += 1
                        assigned = True
                        _write_classification_log(
                            issue_id=issue["id"], band="A", decision="matched",
                            matched_subtopic_id=top["subtopic_id"],
                            matched_subtopic_name=top.get("name"),
                            confidence_score=confidence, weaviate_candidates=candidates,
                            auto_create=auto_create,
                        )
                        yield _emit({
                            "type": "issue_matched", "band": band,
                            "subtopic_id": top["subtopic_id"],
                            "subtopic_name": top.get("name"),
                            "confidence": confidence, "match_method": "vector_direct",
                            **issue_meta,
                        })

                elif top_distance < config.BAND_B_CEILING:
                    # Band B — LLM arbitration over mix of approved + pending candidates
                    band = "B"
                    band_b_candidates = [c for c in candidates if c["distance"] < config.BAND_B_CEILING]
                    arbitration, arb_sys, arb_usr, arb_raw, arb_usage = _call_arbitration(issue, band_b_candidates)
                    arb_cost = config.compute_cost(config.MODEL_ARBITRATION, arb_usage.get("input_tokens", 0), arb_usage.get("output_tokens", 0))

                    if arbitration.get("matched"):
                        match_type = arbitration.get("type", "subtopic")
                        confidence = round(1 - top_distance, 4)

                        if match_type == "candidate":
                            cand_id = arbitration.get("candidate_id")
                            if cand_id:
                                _link_issue_to_candidate(issue["id"], cand_id)
                                cand_name = next((c["name"] for c in candidates if c.get("candidate_id") == cand_id), None)
                                matched += 1
                                assigned = True
                                _write_classification_log(
                                    issue_id=issue["id"], band="B", decision="linked_to_candidate",
                                    matched_subtopic_name=cand_name, confidence_score=confidence,
                                    weaviate_candidates=candidates,
                                    prompt_used=f"SYSTEM:\n{arb_sys}\n\nUSER:\n{arb_usr}",
                                    claude_response=arb_raw, model_used=config.MODEL_ARBITRATION,
                                    input_tokens=arb_usage.get("input_tokens"),
                                    output_tokens=arb_usage.get("output_tokens"),
                                    cost_usd=arb_cost, auto_create=auto_create,
                                )
                                yield _emit({
                                    "type": "issue_unmatched", "band": band,
                                    "proposed_subtopic": cand_name,
                                    "linked_to_candidate": cand_id,
                                    "rationale": arbitration.get("rationale"), **issue_meta,
                                })
                            else:
                                assigned = False
                        else:
                            sub_id = arbitration.get("subtopic_id")
                            if sub_id:
                                subtopic_name = next((c["name"] for c in candidates if c.get("subtopic_id") == sub_id), None)
                                _assign_subtopic(issue["id"], sub_id, confidence, "llm_confirmed")
                                matched += 1
                                assigned = True
                                _write_classification_log(
                                    issue_id=issue["id"], band="B", decision="matched",
                                    matched_subtopic_id=sub_id, matched_subtopic_name=subtopic_name,
                                    confidence_score=confidence, weaviate_candidates=candidates,
                                    prompt_used=f"SYSTEM:\n{arb_sys}\n\nUSER:\n{arb_usr}",
                                    claude_response=arb_raw, model_used=config.MODEL_ARBITRATION,
                                    input_tokens=arb_usage.get("input_tokens"),
                                    output_tokens=arb_usage.get("output_tokens"),
                                    cost_usd=arb_cost, auto_create=auto_create,
                                )
                                yield _emit({
                                    "type": "issue_matched", "band": band,
                                    "subtopic_id": sub_id, "subtopic_name": subtopic_name,
                                    "confidence": confidence, "match_method": "llm_confirmed",
                                    "rationale": arbitration.get("rationale"), **issue_meta,
                                })
                            else:
                                assigned = False
                    else:
                        _write_classification_log(
                            issue_id=issue["id"], band="B", decision="rejected_to_C",
                            weaviate_candidates=candidates,
                            prompt_used=f"SYSTEM:\n{arb_sys}\n\nUSER:\n{arb_usr}",
                            claude_response=arb_raw, model_used=config.MODEL_ARBITRATION,
                            input_tokens=arb_usage.get("input_tokens"),
                            output_tokens=arb_usage.get("output_tokens"),
                            cost_usd=arb_cost, auto_create=auto_create,
                        )
                        assigned = False

            # Band C — no match found in either approved subtopics or pending candidates
            if not assigned:
                band = "C"
                proposal, ns_sys, ns_usr, ns_raw, ns_usage = _call_new_subtopic(issue, topics)
                ns_cost = config.compute_cost(config.MODEL_NEW_SUBTOPIC, ns_usage.get("input_tokens", 0), ns_usage.get("output_tokens", 0))

                if auto_create:
                    _topic_id, subtopic_id, _is_new = _create_topic_subtopic(proposal, topics)
                    _assign_subtopic(issue["id"], subtopic_id, 0.0, "new_subtopic")
                    created += 1
                    topics = _load_topics()
                    _write_classification_log(
                        issue_id=issue["id"], band="C", decision="auto_created",
                        matched_subtopic_id=subtopic_id,
                        matched_subtopic_name=proposal.get("suggested_subtopic_name"),
                        weaviate_candidates=candidates,
                        prompt_used=f"SYSTEM:\n{ns_sys}\n\nUSER:\n{ns_usr}",
                        claude_response=ns_raw, model_used=config.MODEL_NEW_SUBTOPIC,
                        input_tokens=ns_usage.get("input_tokens"),
                        output_tokens=ns_usage.get("output_tokens"),
                        cost_usd=ns_cost, auto_create=auto_create,
                    )
                    yield _emit({
                        "type": "issue_created", "band": band,
                        "subtopic_name": proposal.get("suggested_subtopic_name"),
                        "topic_name": proposal.get("topic_name"), **issue_meta,
                    })
                else:
                    # Create candidate immediately and insert into Weaviate as pending
                    # so the next issue in this batch can find it
                    candidate_id = _create_single_candidate(issue, proposal)
                    unmatched_count += 1
                    candidates_created += 1
                    _write_classification_log(
                        issue_id=issue["id"], band="C", decision="unmatched",
                        weaviate_candidates=candidates,
                        prompt_used=f"SYSTEM:\n{ns_sys}\n\nUSER:\n{ns_usr}",
                        claude_response=ns_raw, model_used=config.MODEL_NEW_SUBTOPIC,
                        input_tokens=ns_usage.get("input_tokens"),
                        output_tokens=ns_usage.get("output_tokens"),
                        cost_usd=ns_cost, auto_create=auto_create,
                    )
                    yield _emit({
                        "type": "issue_unmatched", "band": band,
                        "proposed_subtopic": proposal.get("suggested_subtopic_name"),
                        "proposed_topic": proposal.get("topic_name"),
                        "candidate_id": candidate_id, **issue_meta,
                    })

        except Exception as e:
            logger.error("Classification failed for issue %s: %s", issue["id"], e)
            errors += 1
            _write_classification_log(
                issue_id=issue["id"], band=band or "?", decision="error",
                error_message=str(e), auto_create=auto_create,
            )
            yield _emit({"type": "issue_error", "message": str(e), **issue_meta})

    # candidates_created is now incremented inline — no batch clustering needed

    yield _emit({
        "type": "classify_done",
        "matched": matched,
        "created": created,
        "unmatched": unmatched_count,
        "candidates_created": candidates_created,
        "errors": errors,
    })


def run_classification(
    filters: Optional[dict] = None,
    auto_create: bool = False,
    limit: Optional[int] = None,
) -> dict:
    """
    Non-streaming classification. Consumes the generator and returns a summary dict.
    """
    matched = 0
    created = 0
    unmatched = 0
    candidates_created = 0
    errors = 0

    for event in stream_classification(filters=filters, auto_create=auto_create, limit=limit):
        event_type = event.get("type")
        if event_type == "issue_matched":
            matched += 1
        elif event_type == "issue_created":
            created += 1
        elif event_type == "issue_unmatched":
            unmatched += 1
        elif event_type == "issue_error":
            errors += 1
        elif event_type == "candidate_created":
            candidates_created = event.get("count", 0)

    return {
        "matched": matched,
        "created": created,
        "unmatched": unmatched,
        "candidates_created": candidates_created,
        "errors": errors,
    }
