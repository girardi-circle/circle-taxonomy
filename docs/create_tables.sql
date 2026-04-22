-- =============================================================================
-- Taxonomy schema — full DDL for Redshift
-- Includes SORTKEY / DISTKEY / DISTSTYLE optimised for query patterns in use.
-- Run in order: dimension tables first, then core tables, then audit tables.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS taxonomy;


-- =============================================================================
-- DIMENSION TABLES (pre-populated, small, rarely change)
-- =============================================================================

CREATE TABLE taxonomy.product_areas (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    description VARCHAR(2000),
    slack_channel VARCHAR(100)
)
DISTSTYLE ALL;
-- Small lookup table — broadcast to all nodes to avoid shuffle on joins


CREATE TABLE taxonomy.natures (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL,
    description VARCHAR(255)
)
DISTSTYLE ALL;
-- Values: Bug, Feedback, Question, Complaint, Feature Request, Exploration, Cancellation


CREATE TABLE taxonomy.intents (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL,
    description VARCHAR(255)
)
DISTSTYLE ALL;
-- Values: Support, Action, Insights, Strategy, Sales


-- =============================================================================
-- CORE TABLES
-- =============================================================================

CREATE TABLE taxonomy.topics (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    product_area_id INT REFERENCES taxonomy.product_areas(id),
    name            VARCHAR(255) NOT NULL,
    description     VARCHAR(1000),
    created_at      TIMESTAMP DEFAULT GETDATE(),
    is_active       BOOLEAN DEFAULT TRUE,
    merged_into_id  INT
)
DISTSTYLE ALL
SORTKEY (is_active);
-- Small table — broadcast to all nodes.
-- Nearly every query filters WHERE is_active = TRUE.


CREATE TABLE taxonomy.sub_topics (
    id                    INT IDENTITY(1,1) PRIMARY KEY,
    topic_id              INT NOT NULL REFERENCES taxonomy.topics(id),
    name                  VARCHAR(255) NOT NULL,
    canonical_description VARCHAR(2000),
    match_count           INT DEFAULT 0,
    created_at            TIMESTAMP DEFAULT GETDATE(),
    is_active             BOOLEAN DEFAULT TRUE,
    merged_into_id        INT
)
DISTKEY (topic_id)
SORTKEY (topic_id, is_active);
-- Co-located with topics for merge/move joins.
-- Most queries filter by topic_id + is_active.


CREATE TABLE taxonomy.transcripts (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    source_id    VARCHAR(255) NOT NULL,
    source_type  VARCHAR(50)  NOT NULL,
    community_id INT,
    title        VARCHAR(2000),
    raw_text     VARCHAR(65535),
    source_url   VARCHAR(255),
    summary      VARCHAR(2000),
    ingested_at  TIMESTAMP DEFAULT GETDATE()
)
SORTKEY (ingested_at);
-- summary IS NULL = unprocessed; ordered by ingested_at for pipeline batching.


CREATE TABLE taxonomy.classified_issues (
    id                    INT IDENTITY(1,1) PRIMARY KEY,
    transcript_id         INT NOT NULL REFERENCES taxonomy.transcripts(id),
    extraction_log_id     INT,
    sub_topic_id          INT REFERENCES taxonomy.sub_topics(id),
    nature_id             INT NOT NULL REFERENCES taxonomy.natures(id),
    intent_id             INT NOT NULL REFERENCES taxonomy.intents(id),
    segment_description   VARCHAR(2000),
    verbatim_excerpt      VARCHAR(65535),
    sentiment             VARCHAR(20),
    confidence_score      FLOAT,
    match_method          VARCHAR(20),
    classification_status VARCHAR(20) DEFAULT 'pending',
    classified_at         TIMESTAMP DEFAULT GETDATE()
)
DISTKEY (sub_topic_id)
SORTKEY (classification_status, classified_at);
-- Co-located with sub_topics for merge/reassign/centroid joins.
-- Pipeline fetches WHERE classification_status = 'pending' ORDER BY classified_at.


CREATE TABLE taxonomy.emerging_candidates (
    id                       INT IDENTITY(1,1) PRIMARY KEY,
    issue_ids                VARCHAR(2000),
    suggested_topic_name     VARCHAR(255),
    suggested_subtopic_name  VARCHAR(255),
    suggested_product_area_id INT REFERENCES taxonomy.product_areas(id),
    canonical_description    VARCHAR(2000),
    cluster_size             INT,
    avg_similarity           FLOAT,
    status                   VARCHAR(20) DEFAULT 'pending',
    reviewed_by              VARCHAR(100),
    created_at               TIMESTAMP DEFAULT GETDATE()
)
SORTKEY (status, created_at);
-- Review queue is always filtered by status = 'pending', ordered by created_at.


-- =============================================================================
-- AUDIT / LOG TABLES
-- =============================================================================

CREATE TABLE taxonomy.extraction_logs (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    transcript_id INT NOT NULL REFERENCES taxonomy.transcripts(id),
    model         VARCHAR(100) NOT NULL,
    prompt_system VARCHAR(2000) NOT NULL,
    prompt_user   VARCHAR(4000) NOT NULL,
    response_raw  VARCHAR(65535),
    issues_created INT,
    status        VARCHAR(20) NOT NULL,
    error_message VARCHAR(2000),
    input_tokens  INT,
    output_tokens INT,
    cost_usd      FLOAT,
    triggered_by  VARCHAR(50) DEFAULT 'ui',
    executed_at   TIMESTAMP DEFAULT GETDATE()
)
SORTKEY (executed_at);
-- Audit log queried by date range and transcript; triggered_by added for Dagster tracking.


CREATE TABLE taxonomy.classification_logs (
    id                   INT IDENTITY(1,1) PRIMARY KEY,
    issue_id             INT NOT NULL REFERENCES taxonomy.classified_issues(id),
    band                 VARCHAR(10) NOT NULL,
    decision             VARCHAR(20) NOT NULL,
    matched_subtopic_id  INT,
    matched_subtopic_name VARCHAR(255),
    confidence_score     FLOAT,
    weaviate_candidates  VARCHAR(4000),
    prompt_used          VARCHAR(65535),
    claude_response      VARCHAR(4000),
    model_used           VARCHAR(100),
    input_tokens         INT,
    output_tokens        INT,
    cost_usd             FLOAT,
    auto_create          BOOLEAN DEFAULT FALSE,
    error_message        VARCHAR(2000),
    triggered_by         VARCHAR(50) DEFAULT 'ui',
    classified_at        TIMESTAMP DEFAULT GETDATE()
)
DISTKEY (issue_id)
SORTKEY (classified_at);
-- Co-located with classified_issues for per-issue log lookups.
-- triggered_by added for Dagster tracking.


CREATE TABLE taxonomy.issue_reprocess_logs (
    id                      INT IDENTITY(1,1) PRIMARY KEY,
    issue_id                INT NOT NULL REFERENCES taxonomy.classified_issues(id),
    model                   VARCHAR(100) NOT NULL,
    old_segment_description VARCHAR(2000),
    new_segment_description VARCHAR(2000),
    verbatim_excerpt        VARCHAR(65535),
    input_tokens            INT,
    output_tokens           INT,
    cost_usd                FLOAT,
    reprocessed_at          TIMESTAMP DEFAULT GETDATE()
)
SORTKEY (reprocessed_at);


CREATE TABLE taxonomy.taxonomy_changes (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    action_type VARCHAR(30) NOT NULL,
    entity_type VARCHAR(10) NOT NULL,
    source_id   INT NOT NULL,
    source_name VARCHAR(255),
    target_id   INT,
    target_name VARCHAR(255),
    notes       VARCHAR(1000),
    performed_at TIMESTAMP DEFAULT GETDATE()
)
SORTKEY (performed_at);
-- Audit trail queried by date; no heavy joins needed.


CREATE TABLE taxonomy.ai_review_sessions (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    topic_ids     VARCHAR(2000),
    model         VARCHAR(100),
    input_tokens  INT,
    output_tokens INT,
    cost_usd      FLOAT,
    batches       INT,
    created_at    TIMESTAMP DEFAULT GETDATE()
)
SORTKEY (created_at);


CREATE TABLE taxonomy.ai_review_suggestions (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    session_id      INT NOT NULL REFERENCES taxonomy.ai_review_sessions(id),
    suggestion_idx  INT NOT NULL,
    suggestion_type VARCHAR(30),
    title           VARCHAR(255),
    payload         VARCHAR(4000),
    status          VARCHAR(10) DEFAULT 'pending',
    applied_at      TIMESTAMP,
    skipped_at      TIMESTAMP
)
DISTKEY (session_id)
SORTKEY (session_id, suggestion_idx);
-- Co-located with sessions; always queried by session_id + suggestion_idx.


-- =============================================================================
-- SEED DATA
-- =============================================================================

INSERT INTO taxonomy.product_areas (name, description) VALUES
    ('CMS',          'Content management and publishing tools'),
    ('Live',         'Live streaming and video features'),
    ('Paywalls',     'Monetisation and access control'),
    ('Growth',       'Acquisition, onboarding, and conversion'),
    ('CRM',          'Member management and community features'),
    ('Email Hub',    'Email broadcasting and automation'),
    ('Apps',         'Mobile apps and integrations'),
    ('Circle Plus',  'Premium and enterprise features');

INSERT INTO taxonomy.natures (name, description) VALUES
    ('Bug',             'A defect or unexpected behaviour in the product'),
    ('Feedback',        'General opinion or reaction to the product'),
    ('Question',        'A request for information or clarification'),
    ('Complaint',       'Dissatisfaction with the product or service'),
    ('Feature Request', 'A request for new or improved functionality'),
    ('Exploration',     'Investigating capabilities without a specific issue'),
    ('Cancellation',    'Intent or action to cancel or leave');

INSERT INTO taxonomy.intents (name, description) VALUES
    ('Support',   'Customer needs help resolving an issue'),
    ('Action',    'Customer wants to take a specific action'),
    ('Insights',  'Gathering data or understanding usage patterns'),
    ('Strategy',  'Planning or decision-making at a higher level'),
    ('Sales',     'Interest in purchasing or upgrading');
