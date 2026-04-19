"""
Simple clustering for unmatched issues by Claude-proposed subtopic name.
"""


def cluster_by_proposal(unmatched_items: list[dict]) -> list[dict]:
    """
    Groups unmatched issues by their Claude-proposed (topic_name, subtopic_name).
    Each group becomes one emerging_candidate with cluster_size = number of issues
    in the group.

    Uses suggested_subtopic_name (lowercased + stripped) as the clustering key
    since it is more specific than the topic name.

    Args:
        unmatched_items: list of {"issue": issue_row, "proposal": claude_proposal_dict}

    Returns:
        list of cluster dicts:
        {
            "issue_ids": [int, ...],
            "suggested_topic_name": str,
            "suggested_subtopic_name": str,
            "canonical_description": str,
            "cluster_size": int,
            "representative_proposal": dict,  # from the first issue in the cluster
        }
    """
    groups: dict[str, list[dict]] = {}

    for item in unmatched_items:
        proposal = item.get("proposal") or {}
        subtopic_name = proposal.get("suggested_subtopic_name") or ""
        key = subtopic_name.lower().strip()
        if key not in groups:
            groups[key] = []
        groups[key].append(item)

    clusters = []
    for _key, items in groups.items():
        first_proposal = items[0].get("proposal") or {}
        issue_ids = [
            item["issue"]["id"]
            for item in items
            if item.get("issue") and item["issue"].get("id")
        ]
        clusters.append(
            {
                "issue_ids": issue_ids,
                "suggested_topic_name": first_proposal.get("topic_name") or "",
                "suggested_subtopic_name": first_proposal.get("suggested_subtopic_name") or "",
                "canonical_description": first_proposal.get("canonical_description") or "",
                "cluster_size": len(items),
                "representative_proposal": first_proposal,
            }
        )

    return clusters
