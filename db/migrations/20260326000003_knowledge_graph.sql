-- migrate:up

-- Knowledge Graph Nodes
-- Stores all node types: Video, Transcript, Segment, Topic, Concept, NarrativeFlow
CREATE TABLE knowledge_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,
    name VARCHAR(500),
    text_content TEXT,
    properties JSONB NOT NULL DEFAULT '{}',
    content_hash VARCHAR(64),
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for knowledge_nodes
CREATE INDEX idx_kn_type ON knowledge_nodes(type);
CREATE INDEX idx_kn_content_hash ON knowledge_nodes(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_kn_name_fts ON knowledge_nodes USING gin(to_tsvector('simple', COALESCE(name, '')));
CREATE INDEX idx_kn_text_fts ON knowledge_nodes USING gin(
    to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, ''))
);
CREATE INDEX idx_kn_embedding ON knowledge_nodes USING hnsw (embedding vector_cosine_ops);

-- Knowledge Graph Edges (single table pattern)
-- Types: CONTAINS, FOLLOWS, MENTIONS, RELATES_TO, PART_OF_TOPIC, MEMBER_OF, STEP_IN_FLOW, CROSS_REFS
CREATE TABLE knowledge_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for knowledge_edges
CREATE INDEX idx_ke_source ON knowledge_edges(source_id);
CREATE INDEX idx_ke_target ON knowledge_edges(target_id);
CREATE INDEX idx_ke_type ON knowledge_edges(type);
CREATE INDEX idx_ke_source_type ON knowledge_edges(source_id, type);
CREATE INDEX idx_ke_target_type ON knowledge_edges(target_id, type);

-- migrate:down

DROP TABLE IF EXISTS knowledge_edges;
DROP TABLE IF EXISTS knowledge_nodes;
