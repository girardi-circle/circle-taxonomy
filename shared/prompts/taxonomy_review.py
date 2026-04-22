"""
Prompt 6 — Taxonomy AI Review.

Supports two independent review modes in a single prompt:
- Topic-level: evaluate selected topics as units → merge_topics, rename_topic
- Subtopic-level: evaluate selected subtopics in detail → merge_subtopics, move_subtopic, rename_subtopic

Either or both sections may be present depending on what the user selected.
"""


def build_taxonomy_review_prompt(
    topics_for_unit_review: list[dict],       # topics selected as whole units
    subtopics_for_detail_review: list[dict],  # individual subtopics selected for detail review
    all_topics_reference: list[dict],         # compact list of ALL topics for merge context
    all_subtopics_reference: list[dict],      # compact list of ALL subtopics for move context
    batch_info: str = "",
) -> tuple[str, str]:
    system = (
        "You are a taxonomy architect for a customer support classification system. "
        "You analyze topics and subtopics and return concrete, actionable suggestions "
        "to reduce fragmentation, merge overlapping categories, move misplaced subtopics, "
        "and rename unclear ones. You will receive one or two review sections — analyze "
        "each independently and return only the suggestion types appropriate for each."
    )

    sections = []
    batch_note = f"\n[{batch_info}]" if batch_info else ""

    # ── Section 1: Topic-level review ────────────────────────────────────────
    if topics_for_unit_review:
        topic_lines = []
        for t in topics_for_unit_review:
            pa = t.get("product_area_name") or "Unassigned"
            subtopic_names = [st["name"] for st in (t.get("subtopics") or [])]
            topic_lines.append(
                f"\n  TOPIC ID={t['id']}: {t['name']} [{pa}]"
                + (f"\n    Description: {t['description']}" if t.get("description") else "")
                + f"\n    Subtopics ({len(subtopic_names)}): {', '.join(subtopic_names[:10])}"
                + (" …" if len(subtopic_names) > 10 else "")
            )

        ref_lines = []
        for t in all_topics_reference:
            ref_lines.append(f"  Topic ID={t['id']}: {t['name']} [{t.get('product_area_name') or 'Unassigned'}] ({t.get('subtopic_count', '?')} subtopics)")

        sections.append(f"""\
=== SECTION 1: TOPICS UNDER REVIEW AS UNITS ===
Evaluate whether these topics should be merged with other existing topics or renamed.
Do NOT evaluate individual subtopics here — only the topic level.
{"".join(topic_lines)}

ALL EXISTING TOPICS (reference for merges):
{"".join(ref_lines)}

For this section only suggest: merge_topics, rename_topic""")

    # ── Section 2: Subtopic-level review ─────────────────────────────────────
    if subtopics_for_detail_review:
        subtopic_lines = []
        for st in subtopics_for_detail_review:
            subtopic_lines.append(f"\n  SUBTOPIC ID={st['id']}: {st['name']} (topic: {st.get('topic_name', '?')}, {st['match_count']} issues)")
            if st.get("canonical_description"):
                subtopic_lines.append(f"    Definition: {st['canonical_description']}")
            for ex in (st.get("examples") or [])[:2]:
                subtopic_lines.append(f"    Example: \"{ex}\"")
            for sim in (st.get("similar_subtopics") or [])[:3]:
                subtopic_lines.append(f"    ⚠ Similar (distance={sim['distance']}): ST ID={sim['subtopic_id']} \"{sim['name']}\"")

        ref_lines = []
        current_topic = None
        for row in all_subtopics_reference:
            if row["topic_name"] != current_topic:
                current_topic = row["topic_name"]
                ref_lines.append(f"  Topic: {row['topic_name']} (ID={row['topic_id']})")
            ref_lines.append(f"    • ST ID={row['subtopic_id']}: {row['subtopic_name']} ({row['match_count']} issues)")

        sections.append(f"""\
=== SECTION 2: SUBTOPICS UNDER DETAILED REVIEW ===
Evaluate whether these subtopics should be merged, moved to a different topic, or renamed.
Lines marked ⚠ indicate Weaviate-detected similarity — these are strong merge candidates.
{"".join(subtopic_lines)}

ALL EXISTING TOPICS & SUBTOPICS (reference for moves):
{"".join(ref_lines)}

For this section only suggest: merge_subtopics, move_subtopic, rename_subtopic""")

    combined_sections = "\n\n".join(sections)

    user = f"""Review the taxonomy items below and return actionable suggestions.{batch_note}

{combined_sections}

Rules:
- Changes are NOT mandatory — if a topic or subtopic is already well-scoped, correctly named, and properly placed, do not suggest modifying it
- Only suggest changes with a clear semantic justification
- Proposed names must be specific and meaningful — never "Unknown", "General", "Other"
- Proposed canonical descriptions must be neutral, present-tense, system-as-subject
- For moves, reference the EXACT target topic ID from the reference list
- For every item you decide to leave unchanged, add it to "looks_good" with a brief explanation of why no change is needed
- Prioritize suggestions that affect the most issues

Respond with valid JSON only:
{{
  "suggestions": [
    {{
      "type": "merge_topics",
      "title": "...",
      "rationale": "...",
      "topic_ids": [N, ...],
      "topic_names": ["..."],
      "surviving_topic_id": N,
      "proposed_name": "...",
      "proposed_description": "..."
    }},
    {{
      "type": "rename_topic",
      "title": "...",
      "rationale": "...",
      "topic_id": N,
      "current_name": "...",
      "proposed_name": "...",
      "proposed_description": "..."
    }},
    {{
      "type": "merge_subtopics",
      "title": "...",
      "rationale": "...",
      "subtopic_ids": [N, ...],
      "subtopic_names": ["..."],
      "surviving_subtopic_id": N,
      "proposed_name": "...",
      "proposed_description": "...",
      "estimated_issues": N
    }},
    {{
      "type": "move_subtopic",
      "title": "...",
      "rationale": "...",
      "subtopic_id": N,
      "subtopic_name": "...",
      "from_topic_id": N,
      "from_topic_name": "...",
      "to_topic_id": N,
      "to_topic_name": "..."
    }},
    {{
      "type": "rename_subtopic",
      "title": "...",
      "rationale": "...",
      "subtopic_id": N,
      "current_name": "...",
      "proposed_name": "...",
      "proposed_description": "..."
    }}
  ],
  "looks_good": [
    {{
      "type": "topic",
      "topic_id": N,
      "name": "topic name",
      "rationale": "brief explanation of why it needs no change"
    }},
    {{
      "type": "subtopic",
      "subtopic_id": N,
      "topic_id": N,
      "topic_name": "parent topic name",
      "name": "subtopic name",
      "rationale": "brief explanation of why it needs no change"
    }}
  ]
}}"""

    return system, user
