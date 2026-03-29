-- migrate:up
BEGIN;

-- 1. videos -> content_sources リネーム
ALTER TABLE videos RENAME TO content_sources;

-- 2. source_type制約を拡張
ALTER TABLE content_sources DROP CONSTRAINT chk_source_type;
ALTER TABLE content_sources ADD CONSTRAINT chk_source_type
  CHECK (source_type IN ('vimeo', 'youtube', 'chatwork', 'text'));

-- 3. 新カラム追加
ALTER TABLE content_sources
  ADD COLUMN source_name VARCHAR(100),
  ADD COLUMN content_type VARCHAR(20) NOT NULL DEFAULT 'video'
    CHECK (content_type IN ('video', 'chat', 'document'));

-- 4. インデックス名の更新
ALTER INDEX idx_videos_ingest_status RENAME TO idx_cs_ingest_status;
ALTER INDEX idx_videos_source RENAME TO idx_cs_source;

-- 5. unique制約名の更新
ALTER INDEX uq_videos_source RENAME TO uq_cs_source;

-- 6. トリガーの再作成（テーブル名変更に追従）
DROP TRIGGER IF EXISTS update_videos_updated_at ON content_sources;
CREATE TRIGGER update_content_sources_updated_at
  BEFORE UPDATE ON content_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. ingest_log の外部キーカラム名変更
ALTER TABLE ingest_log RENAME COLUMN video_id TO source_id;

-- 8. knowledge_nodes の properties 内 video_id -> source_id キー名移行
UPDATE knowledge_nodes
SET properties = properties - 'video_id' || jsonb_build_object('source_id', properties->>'video_id')
WHERE properties ? 'video_id';

UPDATE knowledge_nodes
SET properties = properties - 'video_title' || jsonb_build_object('source_title', properties->>'video_title')
WHERE properties ? 'video_title';

-- 9. chat_messages.sources JSONB内の video_id/video_title キー名移行
UPDATE chat_messages
SET sources = (
  SELECT jsonb_agg(
    elem - 'video_id' - 'video_title'
    || jsonb_build_object(
         'source_id', elem->>'video_id',
         'source_title', elem->>'video_title',
         'source_type', 'video'
       )
  )
  FROM jsonb_array_elements(sources) AS elem
)
WHERE sources IS NOT NULL AND sources::text LIKE '%video_id%';

COMMIT;

-- migrate:down
BEGIN;

-- 9. chat_messages.sources JSONB復元
UPDATE chat_messages
SET sources = (
  SELECT jsonb_agg(
    elem - 'source_id' - 'source_title' - 'source_type'
    || jsonb_build_object(
         'video_id', elem->>'source_id',
         'video_title', elem->>'source_title'
       )
  )
  FROM jsonb_array_elements(sources) AS elem
)
WHERE sources IS NOT NULL AND sources::text LIKE '%source_id%';

-- 8. knowledge_nodes の properties 復元
UPDATE knowledge_nodes
SET properties = properties - 'source_title' || jsonb_build_object('video_title', properties->>'source_title')
WHERE properties ? 'source_title';

UPDATE knowledge_nodes
SET properties = properties - 'source_id' || jsonb_build_object('video_id', properties->>'source_id')
WHERE properties ? 'source_id';

-- 7. ingest_log のカラム名復元
ALTER TABLE ingest_log RENAME COLUMN source_id TO video_id;

-- 6. トリガー: テーブルリネーム前に削除、リネーム後に再作成
DROP TRIGGER IF EXISTS update_content_sources_updated_at ON content_sources;

-- 5. unique制約名の復元
ALTER INDEX uq_cs_source RENAME TO uq_videos_source;

-- 4. インデックス名の復元
ALTER INDEX idx_cs_source RENAME TO idx_videos_source;
ALTER INDEX idx_cs_ingest_status RENAME TO idx_videos_ingest_status;

-- 3. 新カラム削除
ALTER TABLE content_sources DROP COLUMN content_type;
ALTER TABLE content_sources DROP COLUMN source_name;

-- 2. source_type制約を元に戻す
ALTER TABLE content_sources DROP CONSTRAINT chk_source_type;
ALTER TABLE content_sources ADD CONSTRAINT chk_source_type
  CHECK (source_type IN ('vimeo', 'youtube'));

-- 1. content_sources -> videos リネーム
ALTER TABLE content_sources RENAME TO videos;

-- トリガー再作成（テーブルリネーム後）
CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
