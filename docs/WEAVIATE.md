# WEAVIATE.md

## Weaviate Collection Schema & Query Patterns

Weaviate serves a single purpose in this system: **semantic similarity matching for subtopics.** It does not store transcripts, issues, or any customer data.

---

## Collection: SubTopic

### Properties

| Property | Type | Vectorized | Description |
|----------|------|-----------|-------------|
| subtopic_id | int | No | Cross-reference to `taxonomy.sub_topics.id` in Redshift |
| topic_id | int | No | Cross-reference to `taxonomy.topics.id`. Used for filtered queries. |
| product_area_id | int | No | Cross-reference to `taxonomy.product_areas.id`. Nullable. Used for filtered queries. |
| name | text | No | Subtopic name. Stored for readability in results, not vectorized. |
| canonical_description | text | **Yes** | Primary vector field. This is what gets embedded and searched against. |

### Vectorizer configuration

Use Weaviate's built-in text2vec module or an external embedding model. The choice of embedding model affects match quality and threshold calibration.

**Options under consideration:**
- `text2vec-openai` (text-embedding-3-small)
- `text2vec-cohere` (embed-english-v3.0)
- Voyage AI embeddings via custom vectorizer
- Weaviate's built-in `text2vec-transformers`

Whichever model is chosen, the same model must be used for both indexing subtopic descriptions and embedding issue `segment_description` at query time.

### Index configuration

```python
{
    "vectorIndexType": "hnsw",
    "vectorIndexConfig": {
        "ef": 128,
        "efConstruction": 256,
        "maxConnections": 32
    }
}
```

At expected scale (50-500 subtopics), a single Weaviate node handles this easily.

---

## Query patterns

### Pattern 1: Unfiltered top-N search

Used in Step 2 (Classification) for most issues. Finds the 5 nearest subtopics regardless of topic or product area.

```python
result = (
    client.query
    .get("SubTopic", ["subtopic_id", "topic_id", "product_area_id", "name", "canonical_description"])
    .with_near_text({"concepts": [segment_description]})
    .with_limit(5)
    .with_additional(["distance"])
    .do()
)
```

### Pattern 2: Filtered by product area

Used when the issue's product area is already known. Narrows the search space.

```python
result = (
    client.query
    .get("SubTopic", ["subtopic_id", "topic_id", "name", "canonical_description"])
    .with_near_text({"concepts": [segment_description]})
    .with_where({
        "path": ["product_area_id"],
        "operator": "Equal",
        "valueInt": known_product_area_id
    })
    .with_limit(5)
    .with_additional(["distance"])
    .do()
)
```

### Pattern 3: Filtered by topic

Used when the topic is known and you want to find the most relevant subtopic within it.

```python
result = (
    client.query
    .get("SubTopic", ["subtopic_id", "name", "canonical_description"])
    .with_near_text({"concepts": [segment_description]})
    .with_where({
        "path": ["topic_id"],
        "operator": "Equal",
        "valueInt": known_topic_id
    })
    .with_limit(5)
    .with_additional(["distance"])
    .do()
)
```

### Pattern 4: Second-pass unfiltered check (new subtopic proposal)

Used in Step 2.4. When the filtered search returns no match, run one more unfiltered search at a tighter threshold to catch subtopics under a different product area that are semantically identical. Prevents cross-product-area duplicates.

```python
result = (
    client.query
    .get("SubTopic", ["subtopic_id", "topic_id", "product_area_id", "name", "canonical_description"])
    .with_near_text({"concepts": [segment_description]})
    .with_limit(3)
    .with_additional(["distance"])
    .do()
)

# Only consider results with distance < 0.20 (tighter than normal Band A)
```

### Pattern 5: Duplicate detection (Step 4)

Used in centroid maintenance to find near-duplicate subtopics.

```python
for subtopic in all_subtopics:
    result = (
        client.query
        .get("SubTopic", ["subtopic_id", "name"])
        .with_near_text({"concepts": [subtopic["canonical_description"]]})
        .with_where({
            "path": ["subtopic_id"],
            "operator": "NotEqual",
            "valueInt": subtopic["subtopic_id"]
        })
        .with_limit(3)
        .with_additional(["distance"])
        .do()
    )
    # Flag pairs with distance < 0.15 for human review
```

---

## Write patterns

### Insert new subtopic (after approval)

Called by Step 3 when an emerging candidate is approved.

```python
client.data_object.create(
    class_name="SubTopic",
    data_object={
        "subtopic_id": new_subtopic_id,
        "topic_id": topic_id,
        "product_area_id": product_area_id,  # Can be None
        "name": subtopic_name,
        "canonical_description": canonical_description
    }
)
```

### Update canonical description (centroid maintenance)

Called by Step 4 when a subtopic's description is regenerated.

```python
result = (
    client.query
    .get("SubTopic", ["_additional { id }"])
    .with_where({
        "path": ["subtopic_id"],
        "operator": "Equal",
        "valueInt": target_subtopic_id
    })
    .do()
)

weaviate_id = result["data"]["Get"]["SubTopic"][0]["_additional"]["id"]

client.data_object.update(
    uuid=weaviate_id,
    class_name="SubTopic",
    data_object={
        "canonical_description": new_description
    }
)
```

### Delete subtopic (after merge)

Called when a reviewer merges a duplicate subtopic into another.

```python
result = (
    client.query
    .get("SubTopic", ["_additional { id }"])
    .with_where({
        "path": ["subtopic_id"],
        "operator": "Equal",
        "valueInt": subtopic_id_to_delete
    })
    .do()
)

weaviate_id = result["data"]["Get"]["SubTopic"][0]["_additional"]["id"]
client.data_object.delete(uuid=weaviate_id, class_name="SubTopic")
```

---

## Sync strategy: Redshift → Weaviate

Redshift is the source of truth. Weaviate is a derived search index.

**Writes always go to Redshift first, then sync to Weaviate.** Never write to Weaviate directly without a corresponding Redshift record.

**Sync triggers:**
- New subtopic approved (Step 3) → insert into Weaviate
- Canonical description updated (Step 4) → update in Weaviate
- Subtopic deactivated or merged → delete from Weaviate

**Consistency check:** Step 4 should include a reconciliation step comparing subtopic IDs in Weaviate against active subtopics in Redshift.

---

## Distance interpretation

Weaviate returns cosine distance (0 = identical, 2 = opposite). In practice, values above 0.5 are irrelevant.

| Distance | Interpretation | Pipeline action |
|----------|---------------|----------------|
| < 0.15 | Strong semantic match | Band A: auto-assign subtopic |
| 0.15 – 0.35 | Plausible but ambiguous | Band B: send to Claude for arbitration |
| > 0.35 | No meaningful match | Band C: propose new subtopic |

**These thresholds depend on the embedding model.** Run a calibration set of 50-100 known issue-subtopic pairs to establish the right values.
