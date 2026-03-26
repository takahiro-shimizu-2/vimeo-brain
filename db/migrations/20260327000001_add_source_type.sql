-- migrate:up
BEGIN;

-- 1. 新カラム追加
ALTER TABLE videos ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'vimeo';
ALTER TABLE videos ADD COLUMN source_id VARCHAR(50);

-- 2. 既存データ移行
UPDATE videos SET source_id = vimeo_id;
ALTER TABLE videos ALTER COLUMN source_id SET NOT NULL;

-- 3. 制約・インデックス追加
ALTER TABLE videos ADD CONSTRAINT uq_videos_source UNIQUE (source_type, source_id);
ALTER TABLE videos ADD CONSTRAINT chk_source_type CHECK (source_type IN ('vimeo', 'youtube'));
CREATE INDEX idx_videos_source ON videos(source_type, source_id);

-- 4. 旧カラム削除（既存インデックスを先にDROP）
DROP INDEX IF EXISTS idx_videos_vimeo_id;
ALTER TABLE videos DROP COLUMN vimeo_id;

-- 5. knowledge_nodes JSONB内の vimeo_id → source_id キー名移行
UPDATE knowledge_nodes
SET properties = properties - 'vimeo_id' || jsonb_build_object('source_id', properties->>'vimeo_id')
WHERE type = 'Video' AND properties ? 'vimeo_id';

COMMIT;

-- migrate:down
BEGIN;

ALTER TABLE videos ADD COLUMN vimeo_id VARCHAR(50);
UPDATE videos SET vimeo_id = source_id WHERE source_type = 'vimeo';
DROP INDEX IF EXISTS idx_videos_source;
ALTER TABLE videos DROP CONSTRAINT IF EXISTS chk_source_type;
ALTER TABLE videos DROP CONSTRAINT IF EXISTS uq_videos_source;
ALTER TABLE videos DROP COLUMN source_id;
ALTER TABLE videos DROP COLUMN source_type;
CREATE INDEX idx_videos_vimeo_id ON videos(vimeo_id);

-- knowledge_nodes JSONB復元
UPDATE knowledge_nodes
SET properties = properties - 'source_id' || jsonb_build_object('vimeo_id', properties->>'source_id')
WHERE type = 'Video' AND properties ? 'source_id';

COMMIT;
