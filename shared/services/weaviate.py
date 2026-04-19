import threading
import logging
from typing import Optional

import weaviate
import weaviate.classes.config as wvcc
import weaviate.classes.query as wvcq
from weaviate.classes.config import Configure, Property, DataType

from shared import config

logger = logging.getLogger(__name__)

_client: Optional[weaviate.WeaviateClient] = None
_client_lock = threading.Lock()

# Collection names
SUBTOPIC_COLLECTION = "SubTopic"
CLASSIFIED_ISSUE_COLLECTION = "ClassifiedIssue"
TRANSCRIPT_COLLECTION = "Transcript"


def get_client() -> weaviate.WeaviateClient:
    """Lazy singleton Weaviate client with thread-safe initialization."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = weaviate.connect_to_weaviate_cloud(
                    cluster_url=config.WEAVIATE_URL,
                    auth_credentials=weaviate.auth.AuthApiKey(config.WEAVIATE_API_KEY),
                    skip_init_checks=True,
                )
                logger.info("Weaviate client connected to %s", config.WEAVIATE_URL)
    return _client


def collection_exists(name: str) -> bool:
    """Check if a collection exists in Weaviate."""
    try:
        client = get_client()
        return client.collections.exists(name)
    except Exception as e:
        logger.error("Error checking collection existence for %s: %s", name, e)
        return False


def create_collections() -> None:
    """Create SubTopic, ClassifiedIssue, and Transcript collections if they don't exist."""
    client = get_client()

    # SubTopic collection
    if not client.collections.exists(SUBTOPIC_COLLECTION):
        try:
            client.collections.create(
                name=SUBTOPIC_COLLECTION,
                vectorizer_config=Configure.Vectorizer.text2vec_weaviate(),
                properties=[
                    Property(
                        name="subtopic_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="topic_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="product_area_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="name",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="canonical_description",
                        data_type=DataType.TEXT,
                        skip_vectorization=False,
                        vectorize_property_name=False,
                    ),
                ],
            )
            logger.info("Created collection: %s", SUBTOPIC_COLLECTION)
        except Exception as e:
            logger.error("Failed to create %s collection: %s", SUBTOPIC_COLLECTION, e)
            raise

    # ClassifiedIssue collection
    if not client.collections.exists(CLASSIFIED_ISSUE_COLLECTION):
        try:
            client.collections.create(
                name=CLASSIFIED_ISSUE_COLLECTION,
                vectorizer_config=Configure.Vectorizer.text2vec_weaviate(),
                properties=[
                    Property(
                        name="issue_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="transcript_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="sub_topic_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="topic_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="product_area_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="nature_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="intent_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="sentiment",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="classified_at",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="source_url",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="segment_description",
                        data_type=DataType.TEXT,
                        skip_vectorization=False,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="verbatim_excerpt",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                ],
            )
            logger.info("Created collection: %s", CLASSIFIED_ISSUE_COLLECTION)
        except Exception as e:
            logger.error("Failed to create %s collection: %s", CLASSIFIED_ISSUE_COLLECTION, e)
            raise

    # Transcript collection
    if not client.collections.exists(TRANSCRIPT_COLLECTION):
        try:
            client.collections.create(
                name=TRANSCRIPT_COLLECTION,
                vectorizer_config=Configure.Vectorizer.text2vec_weaviate(),
                properties=[
                    Property(
                        name="transcript_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="source_id",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="source_type",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="community_id",
                        data_type=DataType.INT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="title",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="source_url",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="summary",
                        data_type=DataType.TEXT,
                        skip_vectorization=True,
                        vectorize_property_name=False,
                    ),
                    Property(
                        name="raw_text",
                        data_type=DataType.TEXT,
                        skip_vectorization=False,
                        vectorize_property_name=False,
                    ),
                ],
            )
            logger.info("Created collection: %s", TRANSCRIPT_COLLECTION)
        except Exception as e:
            logger.error("Failed to create %s collection: %s", TRANSCRIPT_COLLECTION, e)
            raise


def search_subtopics(
    segment_description: str,
    limit: int = 5,
    product_area_id: Optional[int] = None,
) -> list[dict]:
    """
    Search SubTopic collection by semantic similarity.
    Returns list of dicts with subtopic_id, topic_id, product_area_id, name,
    canonical_description, distance.
    """
    try:
        client = get_client()
        collection = client.collections.get(SUBTOPIC_COLLECTION)

        filters = None
        if product_area_id is not None:
            filters = wvcq.Filter.by_property("product_area_id").equal(product_area_id)

        results = collection.query.near_text(
            query=segment_description,
            limit=limit,
            filters=filters,
            return_metadata=wvcq.MetadataQuery(distance=True),
        )

        return [
            {
                "subtopic_id": obj.properties.get("subtopic_id") or 0,
                "candidate_id": obj.properties.get("candidate_id") or 0,
                "status": obj.properties.get("status") or "approved",
                "topic_id": obj.properties.get("topic_id"),
                "product_area_id": obj.properties.get("product_area_id"),
                "name": obj.properties.get("name"),
                "canonical_description": obj.properties.get("canonical_description"),
                "distance": obj.metadata.distance,
            }
            for obj in results.objects
        ]
    except Exception as e:
        logger.error("search_subtopics failed: %s", e)
        return []


def migrate_subtopic_schema() -> dict:
    """Add status and candidate_id properties to SubTopic; backfill existing objects as approved."""
    client = get_client()
    collection = client.collections.get(SUBTOPIC_COLLECTION)

    for prop_name, dtype in [("status", DataType.TEXT), ("candidate_id", DataType.INT)]:
        try:
            collection.config.add_property(
                Property(name=prop_name, data_type=dtype,
                         skip_vectorization=True, vectorize_property_name=False)
            )
            logger.info("Added property %s to %s", prop_name, SUBTOPIC_COLLECTION)
        except Exception:
            logger.info("Property %s already exists in %s — skipping", prop_name, SUBTOPIC_COLLECTION)

    # Backfill existing objects that have no status yet
    response = collection.query.fetch_objects(limit=1000)
    migrated = 0
    for obj in response.objects:
        if not obj.properties.get("status"):
            collection.data.update(uuid=obj.uuid, properties={"status": "approved", "candidate_id": 0})
            migrated += 1

    logger.info("Backfilled %d/%d SubTopic objects with status=approved", migrated, len(response.objects))
    return {"migrated": migrated, "total": len(response.objects)}


def _find_candidate_uuid(client: weaviate.WeaviateClient, candidate_id: int) -> Optional[str]:
    """Find the UUID of a pending candidate by its emerging_candidates ID."""
    try:
        collection = client.collections.get(SUBTOPIC_COLLECTION)
        results = collection.query.fetch_objects(
            filters=wvcq.Filter.by_property("candidate_id").equal(candidate_id),
            limit=1,
        )
        if results.objects:
            return str(results.objects[0].uuid)
        return None
    except Exception as e:
        logger.error("_find_candidate_uuid failed for candidate_id=%s: %s", candidate_id, e)
        return None


def _find_subtopic_uuid(client: weaviate.WeaviateClient, subtopic_id: int) -> Optional[str]:
    """Find the UUID of a subtopic by its integer ID."""
    try:
        collection = client.collections.get(SUBTOPIC_COLLECTION)
        results = collection.query.fetch_objects(
            filters=wvcq.Filter.by_property("subtopic_id").equal(subtopic_id),
            limit=1,
        )
        if results.objects:
            return str(results.objects[0].uuid)
        return None
    except Exception as e:
        logger.error("_find_subtopic_uuid failed for subtopic_id=%s: %s", subtopic_id, e)
        return None


def upsert_subtopic(
    subtopic_id: int,
    topic_id: int,
    product_area_id: Optional[int],
    name: str,
    canonical_description: str,
    status: str = "approved",
    candidate_id: int = 0,
) -> None:
    """Insert or update a subtopic in Weaviate.
    status: 'approved' for real subtopics, 'pending' for emerging candidates.
    candidate_id: FK to emerging_candidates for pending entries (0 for approved).
    """
    try:
        client = get_client()
        collection = client.collections.get(SUBTOPIC_COLLECTION)

        props = {
            "subtopic_id": subtopic_id or 0,
            "candidate_id": candidate_id or 0,
            "status": status,
            "topic_id": topic_id or 0,
            "product_area_id": product_area_id if product_area_id is not None else 0,
            "name": name or "",
            "canonical_description": canonical_description or "",
        }

        # For approved subtopics find by subtopic_id; for pending find by candidate_id
        if status == "approved" and subtopic_id:
            existing_uuid = _find_subtopic_uuid(client, subtopic_id)
        elif candidate_id:
            existing_uuid = _find_candidate_uuid(client, candidate_id)
        else:
            existing_uuid = None

        if existing_uuid:
            collection.data.update(uuid=existing_uuid, properties=props)
        else:
            collection.data.insert(properties=props)

        logger.debug("Upserted subtopic/candidate (status=%s id=%s) in Weaviate", status, subtopic_id or candidate_id)
    except Exception as e:
        logger.error("upsert_subtopic failed: %s", e)
        raise


def update_candidate_to_approved(candidate_id: int, subtopic_id: int) -> bool:
    """When a pending candidate is approved, promote its Weaviate entry to approved.
    Returns True if the entry was found and updated, False if not found (caller should upsert)."""
    try:
        client = get_client()
        existing_uuid = _find_candidate_uuid(client, candidate_id)
        if existing_uuid:
            collection = client.collections.get(SUBTOPIC_COLLECTION)
            collection.data.update(uuid=existing_uuid, properties={
                "status": "approved",
                "subtopic_id": subtopic_id,
                "candidate_id": 0,
            })
            logger.debug("Promoted candidate %s → subtopic %s in Weaviate", candidate_id, subtopic_id)
            return True
        logger.debug("update_candidate_to_approved: candidate_id=%s not in Weaviate — caller will upsert", candidate_id)
        return False
    except Exception as e:
        logger.warning("update_candidate_to_approved failed for candidate %s: %s", candidate_id, e)
        return False


def update_subtopic_description(subtopic_id: int, canonical_description: str) -> None:
    """Update only the canonical_description of a subtopic (for centroid maintenance)."""
    try:
        client = get_client()
        collection = client.collections.get(SUBTOPIC_COLLECTION)

        existing_uuid = _find_subtopic_uuid(client, subtopic_id)
        if existing_uuid:
            collection.data.update(
                uuid=existing_uuid,
                properties={"canonical_description": canonical_description},
            )
            logger.debug("Updated canonical_description for subtopic %s", subtopic_id)
        else:
            logger.warning("update_subtopic_description: subtopic_id=%s not found in Weaviate", subtopic_id)
    except Exception as e:
        logger.error("update_subtopic_description failed for subtopic_id=%s: %s", subtopic_id, e)
        raise


def delete_candidate(candidate_id: int) -> None:
    """Remove a pending candidate from Weaviate SubTopic when it is rejected."""
    try:
        client = get_client()
        existing_uuid = _find_candidate_uuid(client, candidate_id)
        if existing_uuid:
            collection = client.collections.get(SUBTOPIC_COLLECTION)
            collection.data.delete_by_id(uuid=existing_uuid)
            logger.debug("Deleted pending candidate %s from Weaviate SubTopic", candidate_id)
        else:
            logger.debug("delete_candidate: candidate_id=%s not found in Weaviate — nothing to delete", candidate_id)
    except Exception as e:
        logger.warning("delete_candidate failed for candidate_id=%s: %s", candidate_id, e)


def delete_subtopic(subtopic_id: int) -> None:
    """Delete a subtopic from Weaviate by its integer ID."""
    try:
        client = get_client()
        collection = client.collections.get(SUBTOPIC_COLLECTION)
        existing_uuid = _find_subtopic_uuid(client, subtopic_id)
        if existing_uuid:
            collection.data.delete_by_id(uuid=existing_uuid)
            logger.debug("Deleted subtopic %s from Weaviate", subtopic_id)
        else:
            logger.warning("delete_subtopic: subtopic_id=%s not found in Weaviate", subtopic_id)
    except Exception as e:
        logger.error("delete_subtopic failed for subtopic_id=%s: %s", subtopic_id, e)
        raise


def _find_issue_uuid(client: weaviate.WeaviateClient, issue_id: int) -> Optional[str]:
    """Find the UUID of a classified issue by its integer ID."""
    try:
        collection = client.collections.get(CLASSIFIED_ISSUE_COLLECTION)
        results = collection.query.fetch_objects(
            filters=wvcq.Filter.by_property("issue_id").equal(issue_id),
            limit=1,
        )
        if results.objects:
            return str(results.objects[0].uuid)
        return None
    except Exception as e:
        logger.error("_find_issue_uuid failed for issue_id=%s: %s", issue_id, e)
        return None


def upsert_classified_issue(issue_data: dict) -> None:
    """Insert or update a classified issue in Weaviate."""
    try:
        client = get_client()
        collection = client.collections.get(CLASSIFIED_ISSUE_COLLECTION)

        issue_id = issue_data.get("issue_id")
        props = {
            "issue_id": issue_id or 0,
            "transcript_id": issue_data.get("transcript_id") or 0,
            "sub_topic_id": issue_data.get("sub_topic_id") or 0,
            "topic_id": issue_data.get("topic_id") or 0,
            "product_area_id": issue_data.get("product_area_id") or 0,
            "nature_id": issue_data.get("nature_id") or 0,
            "intent_id": issue_data.get("intent_id") or 0,
            "sentiment": issue_data.get("sentiment") or "",
            "classified_at": str(issue_data.get("classified_at") or ""),
            "source_url": issue_data.get("source_url") or "",
            "segment_description": issue_data.get("segment_description") or "",
            "verbatim_excerpt": issue_data.get("verbatim_excerpt") or "",
        }

        existing_uuid = _find_issue_uuid(client, issue_id) if issue_id else None
        if existing_uuid:
            collection.data.update(uuid=existing_uuid, properties=props)
        else:
            collection.data.insert(properties=props)

        logger.debug("Upserted classified issue %s in Weaviate", issue_id)
    except Exception as e:
        logger.error("upsert_classified_issue failed for issue_id=%s: %s", issue_data.get("issue_id"), e)
        raise


def update_classified_issue_subtopic(
    issue_id: int,
    sub_topic_id: int,
    topic_id: int,
    product_area_id: Optional[int],
) -> None:
    """Update subtopic-related fields on a classified issue after classification assigns a subtopic."""
    try:
        client = get_client()
        collection = client.collections.get(CLASSIFIED_ISSUE_COLLECTION)

        existing_uuid = _find_issue_uuid(client, issue_id)
        if existing_uuid:
            collection.data.update(
                uuid=existing_uuid,
                properties={
                    "sub_topic_id": sub_topic_id,
                    "topic_id": topic_id,
                    "product_area_id": product_area_id if product_area_id is not None else 0,
                },
            )
            logger.debug("Updated subtopic for issue %s in Weaviate", issue_id)
        else:
            logger.warning("update_classified_issue_subtopic: issue_id=%s not found in Weaviate", issue_id)
    except Exception as e:
        logger.error("update_classified_issue_subtopic failed for issue_id=%s: %s", issue_id, e)
        raise


def _find_transcript_uuid(client: weaviate.WeaviateClient, transcript_id: int) -> Optional[str]:
    """Find the UUID of a transcript by its integer ID."""
    try:
        collection = client.collections.get(TRANSCRIPT_COLLECTION)
        results = collection.query.fetch_objects(
            filters=wvcq.Filter.by_property("transcript_id").equal(transcript_id),
            limit=1,
        )
        if results.objects:
            return str(results.objects[0].uuid)
        return None
    except Exception as e:
        logger.error("_find_transcript_uuid failed for transcript_id=%s: %s", transcript_id, e)
        return None


def upsert_transcript(transcript_data: dict) -> None:
    """Insert or update a transcript in Weaviate."""
    try:
        client = get_client()
        collection = client.collections.get(TRANSCRIPT_COLLECTION)

        transcript_id = transcript_data.get("transcript_id")
        props = {
            "transcript_id": transcript_id or 0,
            "source_id": transcript_data.get("source_id") or "",
            "source_type": transcript_data.get("source_type") or "",
            "community_id": transcript_data.get("community_id") or 0,
            "title": transcript_data.get("title") or "",
            "source_url": transcript_data.get("source_url") or "",
            "summary": transcript_data.get("summary") or "",
            "raw_text": transcript_data.get("raw_text") or "",
        }

        existing_uuid = _find_transcript_uuid(client, transcript_id) if transcript_id else None
        if existing_uuid:
            collection.data.update(uuid=existing_uuid, properties=props)
        else:
            collection.data.insert(properties=props)

        logger.debug("Upserted transcript %s in Weaviate", transcript_id)
    except Exception as e:
        logger.error("upsert_transcript failed for transcript_id=%s: %s", transcript_data.get("transcript_id"), e)
        raise


def bulk_upsert_classified_issues(issues: list[dict]) -> int:
    """Batch insert classified issues using batch.dynamic(). Returns count of inserted."""
    if not issues:
        return 0

    count = 0
    try:
        client = get_client()
        collection = client.collections.get(CLASSIFIED_ISSUE_COLLECTION)

        with collection.batch.dynamic() as batch:
            for issue in issues:
                props = {
                    "issue_id": issue.get("issue_id") or 0,
                    "transcript_id": issue.get("transcript_id") or 0,
                    "sub_topic_id": issue.get("sub_topic_id") or 0,
                    "topic_id": issue.get("topic_id") or 0,
                    "product_area_id": issue.get("product_area_id") or 0,
                    "nature_id": issue.get("nature_id") or 0,
                    "intent_id": issue.get("intent_id") or 0,
                    "sentiment": issue.get("sentiment") or "",
                    "classified_at": str(issue.get("classified_at") or ""),
                    "source_url": issue.get("source_url") or "",
                    "segment_description": issue.get("segment_description") or "",
                    "verbatim_excerpt": issue.get("verbatim_excerpt") or "",
                }
                batch.add_object(properties=props)
                count += 1

        logger.info("Bulk upserted %d classified issues to Weaviate", count)
    except Exception as e:
        logger.error("bulk_upsert_classified_issues failed: %s", e)
        raise

    return count


def bulk_upsert_transcripts(transcripts: list[dict]) -> int:
    """Batch insert transcripts using batch.dynamic(). Returns count of inserted."""
    if not transcripts:
        return 0

    count = 0
    try:
        client = get_client()
        collection = client.collections.get(TRANSCRIPT_COLLECTION)

        with collection.batch.dynamic() as batch:
            for transcript in transcripts:
                props = {
                    "transcript_id": transcript.get("transcript_id") or 0,
                    "source_id": transcript.get("source_id") or "",
                    "source_type": transcript.get("source_type") or "",
                    "community_id": transcript.get("community_id") or 0,
                    "title": transcript.get("title") or "",
                    "source_url": transcript.get("source_url") or "",
                    "summary": transcript.get("summary") or "",
                    "raw_text": transcript.get("raw_text") or "",
                }
                batch.add_object(properties=props)
                count += 1

        logger.info("Bulk upserted %d transcripts to Weaviate", count)
    except Exception as e:
        logger.error("bulk_upsert_transcripts failed: %s", e)
        raise

    return count


def get_collection_counts() -> dict:
    """Return object counts for all three collections."""
    counts = {
        SUBTOPIC_COLLECTION: 0,
        CLASSIFIED_ISSUE_COLLECTION: 0,
        TRANSCRIPT_COLLECTION: 0,
    }
    try:
        client = get_client()
        for name in counts:
            if client.collections.exists(name):
                agg = client.collections.get(name).aggregate.over_all(total_count=True)
                counts[name] = agg.total_count or 0
    except Exception as e:
        logger.error("get_collection_counts failed: %s", e)
    return counts


def find_similar_subtopics(
    canonical_description: str,
    exclude_subtopic_id: Optional[int] = None,
    limit: int = 3,
) -> list[dict]:
    """
    Find similar subtopics for duplicate detection.
    Returns list of dicts with subtopic_id, name, canonical_description, distance.
    """
    try:
        client = get_client()
        collection = client.collections.get(SUBTOPIC_COLLECTION)

        filters = None
        if exclude_subtopic_id is not None:
            filters = wvcq.Filter.by_property("subtopic_id").not_equal(exclude_subtopic_id)

        results = collection.query.near_text(
            query=canonical_description,
            limit=limit + 1,  # fetch extra in case we filter one out
            filters=filters,
            return_metadata=wvcq.MetadataQuery(distance=True),
        )

        return [
            {
                "subtopic_id": obj.properties.get("subtopic_id"),
                "name": obj.properties.get("name"),
                "canonical_description": obj.properties.get("canonical_description"),
                "distance": obj.metadata.distance,
            }
            for obj in results.objects[:limit]
        ]
    except Exception as e:
        logger.error("find_similar_subtopics failed: %s", e)
        return []
