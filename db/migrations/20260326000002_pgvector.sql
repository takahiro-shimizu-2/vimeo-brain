-- migrate:up

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE segment_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  segment_text TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_segment_embeddings_video_id ON segment_embeddings(video_id);
CREATE INDEX idx_segment_embeddings_content_hash ON segment_embeddings(content_hash);

-- migrate:down

DROP TABLE IF EXISTS segment_embeddings;
DROP EXTENSION IF EXISTS vector;
