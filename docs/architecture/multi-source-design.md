# マルチソースコンテンツ対応 設計書

> **Status**: Draft v2 (ReviewAgent指摘反映)
> **Date**: 2026-03-30
> **Author**: Miyabi
> **Review**: 75/100 → 修正適用済み

---

## 1. 背景と目的

### 1.1 現状

vimeo-brainは現在「動画トランスクリプト」専用設計。

- DBテーブル: `videos` (source_type: vimeo | youtube)
- パイプライン: VTT取得 → パース → セグメント化 → 概念抽出 → グラフ構築 → embedding
- UI: 動画一覧/追加/取り込み

### 1.2 目的

「動画中心」→「コンテンツソース中心」へアーキテクチャを汎用化し、以下を実現する:

1. **Chatwork** — API定期取得でチャットログを知識化
2. **テキストファイル** — .txt/.md/.csvアップロードで知識化
3. **将来拡張** — SNS・他チャットツール等も同じパターンで追加可能

### 1.3 設計方針

パイプラインの前段（取得・パース）をプラグイン化し、後段（概念抽出・グラフ構築・embedding）は共通のまま維持。

```
[ContentSourceService]  ← source-specific (Vimeo/YouTube/Chatwork/Text)
      ↓
  fetchContent() → ContentFetchResult { segments: ContentSegment[] }
      ↓
[共通パイプライン]  ← 変更最小限
  Stage 3: Concept Extract  (変更なし)
  Stage 4: Graph Build      (ノード名汎用化)
  Stage 5-7: Community/Flow/Embedding (変更なし)
```

---

## 2. 変更対象ファイル一覧

### 凡例
- 🆕 新規作成
- 📝 変更
- 🔄 リネーム

| レイヤー | ファイル | 操作 | 概要 |
|---------|---------|------|------|
| **DB** | `db/migrations/20260330000001_multi_source.sql` | 🆕 | テーブル名変更・制約拡張 |
| **shared** | `packages/shared/src/types/content-source.ts` | 🆕 | 新型定義 |
| **shared** | `packages/shared/src/types/video.ts` | 📝 | deprecated alias追加 |
| **shared** | `packages/shared/src/index.ts` | 📝 | re-export更新 |
| **backend** | `packages/backend/src/services/content-source.ts` | 📝 | ContentSourceService IF定義 |
| **backend** | `packages/backend/src/services/vimeo.service.ts` | 📝 | ContentSourceService実装 |
| **backend** | `packages/backend/src/services/youtube.service.ts` | 📝 | ContentSourceService実装 |
| **backend** | `packages/backend/src/services/text-source.service.ts` | 🆕 | テキストファイル対応 |
| **backend** | `packages/backend/src/services/chatwork-source.service.ts` | 🆕 | Chatwork対応（スタブ） |
| **backend** | `packages/backend/src/services/ingest.service.ts` | 📝 | 汎用化 |
| **backend** | `packages/backend/src/services/chat.service.ts` | 📝 | プロンプト汎用化 |
| **backend** | `packages/backend/src/repositories/content-source.repository.ts` | 🔄 | video.repository.tsから |
| **backend** | `packages/backend/src/controllers/source.controller.ts` | 🔄 | video.controller.tsから |
| **backend** | `packages/backend/src/app.ts` | 📝 | ルーター登録更新 |
| **backend** | `packages/backend/src/config.ts` | 📝 | CHATWORK_API_TOKEN追加 |
| **engine** | `packages/knowledge-engine/src/pipeline/index.ts` | 📝 | runPipelineFromSegments追加 |
| **engine** | `packages/knowledge-engine/src/pipeline/graph-builder.ts` | 📝 | ノード名汎用化 |
| **engine** | `packages/knowledge-engine/src/schema/nodes.ts` | 📝 | ノードタイプ追加 |
| **engine** | `packages/knowledge-engine/src/search/context-resolver.ts` | 📝 | type weight追加 |
| **engine** | `packages/knowledge-engine/src/db/connection.ts` | 📝 | getVideoGraph→getSourceGraph (内部のみ) |
| **engine** | `packages/knowledge-engine/src/index.ts` | 📝 | 新export追加 |
| **frontend** | `packages/frontend/src/api/sources.api.ts` | 🆕 | 新API呼出 |
| **frontend** | `packages/frontend/src/hooks/useSources.ts` | 🆕 | 新hook |
| **frontend** | `packages/frontend/src/pages/SourcesPage.tsx` | 🆕 | ソース一覧ページ |
| **frontend** | `packages/frontend/src/pages/SourceDetailPage.tsx` | 🆕 | ソース詳細ページ |
| **frontend** | `packages/frontend/src/components/source/AddSourceDialog.tsx` | 🆕 | ソース追加ダイアログ |
| **frontend** | `packages/frontend/src/components/source/SourceCard.tsx` | 🆕 | ソースカード |
| **frontend** | `packages/frontend/src/components/source/SourceList.tsx` | 🆕 | ソースリスト |
| **frontend** | `packages/frontend/src/components/chat/SourceCard.tsx` | 📝 | 汎用化 |
| **frontend** | `packages/frontend/src/App.tsx` | 📝 | ルート更新 |
| **frontend** | `packages/frontend/src/components/layout/Sidebar.tsx` | 📝 | ナビ更新 |

---

## 3. Phase 1: DB マイグレーション

### 3.1 マイグレーション内容

**ファイル**: `db/migrations/20260330000001_multi_source.sql`

```sql
-- migrate:up
BEGIN;

-- 1. videos → content_sources リネーム
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

-- 8. knowledge_nodes の properties 内 video_id → source_id キー名移行
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

UPDATE knowledge_nodes
SET properties = properties - 'source_title' || jsonb_build_object('video_title', properties->>'source_title')
WHERE properties ? 'source_title';

UPDATE knowledge_nodes
SET properties = properties - 'source_id' || jsonb_build_object('video_id', properties->>'source_id')
WHERE properties ? 'source_id';

ALTER TABLE ingest_log RENAME COLUMN source_id TO video_id;

-- トリガー: テーブルリネーム前に削除、リネーム後に再作成
DROP TRIGGER IF EXISTS update_content_sources_updated_at ON content_sources;

ALTER INDEX uq_cs_source RENAME TO uq_videos_source;
ALTER INDEX idx_cs_source RENAME TO idx_videos_source;
ALTER INDEX idx_cs_ingest_status RENAME TO idx_videos_ingest_status;

ALTER TABLE content_sources DROP COLUMN content_type;
ALTER TABLE content_sources DROP COLUMN source_name;

ALTER TABLE content_sources DROP CONSTRAINT chk_source_type;
ALTER TABLE content_sources ADD CONSTRAINT chk_source_type
  CHECK (source_type IN ('vimeo', 'youtube'));

ALTER TABLE content_sources RENAME TO videos;

-- トリガー再作成（テーブルリネーム後）
CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
```

### 3.2 テーブル構造（変更後）

```
content_sources
├── id                UUID (PK)
├── source_type       VARCHAR(20) NOT NULL   ← 'vimeo' | 'youtube' | 'chatwork' | 'text'
├── source_id         VARCHAR(50) NOT NULL
├── title             VARCHAR(500) NOT NULL DEFAULT ''
├── description       TEXT
├── duration_seconds  INTEGER                ← video only (nullable)
├── thumbnail_url     TEXT                   ← video only (nullable)
├── content_hash      VARCHAR(64)
├── ingest_status     VARCHAR(20) NOT NULL DEFAULT 'pending'
├── source_name       VARCHAR(100)           ← 🆕 "Chatwork Room X" etc.
├── content_type      VARCHAR(20) NOT NULL DEFAULT 'video'  ← 🆕 'video' | 'chat' | 'document'
├── created_at        TIMESTAMPTZ
└── updated_at        TIMESTAMPTZ
UNIQUE (source_type, source_id)
```

---

## 4. Phase 2: 共有型定義

### 4.1 新型定義

**ファイル**: `packages/shared/src/types/content-source.ts`

```typescript
// --- Source & Content Types ---

export type ContentType = 'video' | 'chat' | 'document';
export type SourceType = 'vimeo' | 'youtube' | 'chatwork' | 'text';

export interface ContentSource {
  id: string;
  source_type: SourceType;
  source_id: string;
  content_type: ContentType;
  title: string;
  description: string | null;
  source_name: string | null;       // "Chatwork Room X" etc.
  duration_seconds: number | null;  // video only
  thumbnail_url: string | null;     // video only
  content_hash: string | null;
  ingest_status: IngestStatus;
  created_at: Date;
  updated_at: Date;
}

export type IngestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IngestResult {
  source_id: string;           // was video_id
  status: IngestStatus;
  segment_count: number;
  content_hash: string;
  error_message?: string;
}

// --- Source Type → Content Type マッピング ---

export const SOURCE_CONTENT_TYPE_MAP: Record<SourceType, ContentType> = {
  vimeo: 'video',
  youtube: 'video',
  chatwork: 'chat',
  text: 'document',
};

// --- Display helpers ---

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  vimeo: 'Vimeo',
  youtube: 'YouTube',
  chatwork: 'Chatwork',
  text: 'テキスト',
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  video: '動画',
  chat: 'チャット',
  document: 'ドキュメント',
};
```

### 4.2 後方互換

**ファイル**: `packages/shared/src/types/video.ts` (変更)

> **注意**: `content-source.ts` が正規の定義元。`video.ts` は re-export + deprecated alias のみにし、
> 独自の `IngestResult`/`IngestStatus` 定義は持たない（export名衝突を防ぐため）。

```typescript
// Re-export from new location for backward compatibility
// IngestResult は content-source.ts のみで定義（衝突防止）
export type { IngestStatus, IngestResult, ContentSource, SourceType } from './content-source.js';
import type { ContentSource, SourceType } from './content-source.js';

/** @deprecated Use ContentSource instead */
export type Video = ContentSource;

/** @deprecated Use SourceType instead */
export type VideoSourceType = Extract<SourceType, 'vimeo' | 'youtube'>;
```

**`packages/shared/src/index.ts`** — export戦略:

```typescript
// content-source.ts を正として全型をexport
export * from './types/content-source.js';
// video.ts からは deprecated alias のみ（IngestResult/IngestStatus は content-source.ts からのre-exportなので衝突しない）
export * from './types/video.js';
export * from './types/chat.js';
export * from './types/ingest.js';
export * from './types/knowledge.js';
export * from './types/api.js';
```

### 4.3 その他の型変更

**`packages/shared/src/types/chat.ts`** — ChatSource汎用化:

```typescript
export interface ChatSource {
  source_id: string;       // was video_id
  source_title: string;    // was video_title
  source_type: string;     // 🆕
  timestamp_ms: number;    // chat/textの場合は0
  segment_text: string;
}
```

**`packages/shared/src/types/knowledge.ts`** — KnowledgeSegment汎用化:

```typescript
export interface KnowledgeSegment {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  content_hash: string;
  source_id: string;        // was video_id
  source_title: string;     // was video_title
}
```

**`packages/shared/src/types/ingest.ts`** — IngestLog汎用化:

```typescript
export interface IngestLog {
  id: string;
  source_id: string;       // was video_id
  content_hash: string;
  segment_count: number;
  status: IngestStatus;
  last_completed_stage: number | null;
  stage_details: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}
```

---

## 5. Phase 3: バックエンド サービス層

### 5.1 ContentSourceService インターフェース

**ファイル**: `packages/backend/src/services/content-source.ts` (video-source.ts を置き換え)

```typescript
export interface ContentSegment {
  text: string;
  start_ms: number;         // chat/textの場合は0
  end_ms: number;            // chat/textの場合は0
  sequence_index: number;
  speaker: string | null;    // chatの場合は送信者名
  metadata?: Record<string, unknown>;
}

export interface ContentFetchResult {
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;  // duration_seconds, thumbnail_url等
  segments: ContentSegment[];
  rawContent: string;  // ハッシュ計算用
}

export interface ContentSourceService {
  fetchContent(sourceId: string): Promise<ContentFetchResult>;
}

// 旧インターフェースの後方互換
export interface VideoMetadata {
  title: string;
  description: string | null;
  duration_seconds: number;
  thumbnail_url: string | null;
}

/** @deprecated Use ContentSourceService instead */
export interface VideoSourceService {
  getMetadata(sourceId: string): Promise<VideoMetadata>;
  getTranscriptVtt(sourceId: string): Promise<string>;
}
```

### 5.2 既存サービスのアダプタ化

**VimeoService** — 変更方針:

```typescript
// 既存メソッド (getMetadata, getTranscriptVtt) はそのまま残す
// 新たに fetchContent() を追加して ContentSourceService を実装

export class VimeoService implements ContentSourceService {
  // 既存
  async getMetadata(sourceId: string): Promise<VideoMetadata> { ... }
  async getTranscriptVtt(sourceId: string): Promise<string> { ... }

  // 🆕 ContentSourceService 実装
  async fetchContent(sourceId: string): Promise<ContentFetchResult> {
    const metadata = await this.getMetadata(sourceId);
    const vttContent = await this.getTranscriptVtt(sourceId);
    const parsed = parseVtt(vttContent);
    const segments = buildSegments(parsed.cues);

    return {
      title: metadata.title,
      description: metadata.description,
      metadata: {
        duration_seconds: metadata.duration_seconds,
        thumbnail_url: metadata.thumbnail_url,
      },
      segments: segments.map(s => ({
        text: s.text,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        sequence_index: s.sequence_index,
        speaker: s.speaker,
      })),
      rawContent: vttContent,
    };
  }
}
```

**YouTubeService** — 同様のパターンで `fetchContent()` を追加。

### 5.3 新サービス: TextSourceService

**ファイル**: `packages/backend/src/services/text-source.service.ts`

```typescript
import type { ContentSourceService, ContentFetchResult } from './content-source.js';
import { sha256 } from '@vimeo-brain/knowledge-engine';
import fs from 'node:fs/promises';
import path from 'node:path';

export class TextSourceService implements ContentSourceService {
  constructor(private readonly uploadDir: string) {}

  async fetchContent(sourceId: string): Promise<ContentFetchResult> {
    // sourceId = アップロードされたファイルのパス or ID
    const filePath = path.resolve(this.uploadDir, sourceId);
    // パストラバーサル対策
    if (!filePath.startsWith(path.resolve(this.uploadDir))) {
      throw new Error('Invalid source ID: path traversal detected');
    }
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(sourceId).toLowerCase();

    const segments = this.splitIntoSegments(content, ext);

    return {
      title: path.basename(sourceId, ext),
      description: null,
      metadata: { file_type: ext, file_size: content.length },
      segments,
      rawContent: content,
    };
  }

  private splitIntoSegments(content: string, ext: string): ContentSegment[] {
    // パラグラフ単位でセグメント分割（空行区切り）
    const paragraphs = content
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    return paragraphs.map((text, index) => ({
      text,
      start_ms: 0,
      end_ms: 0,
      sequence_index: index,
      speaker: null,
    }));
  }
}
```

### 5.4 新サービス: ChatworkSourceService（スタブ）

**ファイル**: `packages/backend/src/services/chatwork-source.service.ts`

```typescript
import type { ContentSourceService, ContentFetchResult } from './content-source.js';

export class ChatworkSourceService implements ContentSourceService {
  constructor(private readonly apiToken: string) {}

  async fetchContent(roomId: string): Promise<ContentFetchResult> {
    // Phase 1: スタブ実装
    throw new Error(
      'Chatwork integration is not yet implemented. ' +
      'This will be available in a future release.'
    );
  }
}
```

### 5.5 IngestService 汎用化

**変更概要**:

```typescript
// Before
class IngestService {
  private sources: Map<VideoSourceType, VideoSourceService>;
  private videoRepo: VideoRepository;
  async ingest(videoId: string): Promise<IngestResult> { ... }
}

// After
class IngestService {
  private sources: Map<SourceType, ContentSourceService>;
  private sourceRepo: ContentSourceRepository;

  async ingest(sourceId: string): Promise<IngestResult> {
    const source = await this.sourceRepo.findById(sourceId);
    // ...
    const service = this.sources.get(source.source_type);
    const result = await service.fetchContent(source.source_id);

    // メタデータ更新
    if (!source.title && result.title) {
      await this.sourceRepo.updateMetadata(sourceId, {
        title: result.title,
        description: result.description,
        ...result.metadata,
      });
    }

    // 共通パイプライン実行
    const pipelineResult = await runPipelineFromSegments(
      source.source_id,
      result.title || source.title,
      result.description,
      sourceTypeToNodeType(source.source_type),
      result.segments,
      sha256(result.rawContent),
      { pool: this.pool, llmFn, embedFn }
    );

    // ...
  }
}
```

### 5.6 ContentSourceRepository

**変更概要**: video.repository.ts → content-source.repository.ts

```typescript
// テーブル名を content_sources に変更
// カラム名を合わせて更新
// findAll / findById / create / updateStatus / delete のSQL更新

export class ContentSourceRepository {
  async findAll(): Promise<ContentSource[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM content_sources ORDER BY created_at DESC'
    );
    return rows;
  }

  async create(
    sourceType: SourceType,
    sourceId: string,
    contentType: ContentType,
    title?: string,
    sourceName?: string,
  ): Promise<ContentSource> {
    const { rows } = await this.pool.query(
      `INSERT INTO content_sources
         (source_type, source_id, content_type, title, source_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sourceType, sourceId, contentType, title || '', sourceName || null]
    );
    return rows[0];
  }

  // ... 他メソッドも同様
}
```

---

## 6. Phase 4: knowledge-engine パイプライン

### 6.1 runPipelineFromSegments

**ファイル**: `packages/knowledge-engine/src/pipeline/index.ts`

```typescript
// 新しい汎用エントリポイント
export async function runPipelineFromSegments(
  sourceId: string,
  sourceTitle: string,
  sourceDescription: string | null,
  sourceNodeType: string,          // 'Video' | 'ChatRoom' | 'Document'
  segments: ContentSegment[],
  contentHash: string,
  config: PipelineConfig,
  onProgress?: StageProgressFn
): Promise<PipelineResult> {
  const store = new GraphStore(config.pool);

  // 重複チェック
  const existing = await store.findNodeByHash(contentHash);
  if (existing) { /* skip */ }

  // セグメントを BuiltSegment に変換
  const builtSegments: BuiltSegment[] = segments.map(s => ({
    text: s.text,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    sequence_index: s.sequence_index,
    speaker: s.speaker,
    content_hash: sha256(s.text),
  }));

  // Stage 3 から開始 (Stage 1-2 はスキップ)
  const segmentConcepts = await extractConcepts(...);
  // buildGraph を直接拡張（新関数は作らない。シグネチャに sourceNodeType を追加）
  const graphResult = await buildGraph(
    store, sourceId, sourceTitle, sourceDescription,
    sourceNodeType,   // ← 🆕 追加パラメータ
    builtSegments, segmentConcepts, contentHash
  );
  // Stage 5-7: Community → Flow → Embedding (変更なし)
  // ...
}

// 既存の runPipeline はラッパーとして維持（後方互換）
export async function runPipeline(
  videoSourceId: string,
  videoTitle: string,
  videoDescription: string | null,
  vttContent: string,
  config: PipelineConfig,
  onProgress?: StageProgressFn
): Promise<PipelineResult> {
  const parsed = parseVtt(vttContent);
  const segments = buildSegments(parsed.cues);
  return runPipelineFromSegments(
    videoSourceId, videoTitle, videoDescription,
    'Video',
    segments.map(s => ({
      text: s.text, start_ms: s.start_ms, end_ms: s.end_ms,
      sequence_index: s.sequence_index, speaker: s.speaker,
    })),
    sha256(vttContent),
    config, onProgress
  );
}
```

### 6.2 graph-builder 汎用化

**方針**: 既存の `buildGraph` 関数のシグネチャに `sourceNodeType` パラメータを追加する（新関数は作らない）。
`knowledge-engine/src/index.ts` からの既存exportはそのまま維持。

**変更点**:

```typescript
// Before: ハードコードされた 'Video' / 'Transcript' ノード
videoNode = await store.addNode('Video', videoTitle, ...);
transcriptNode = await store.addNode('Transcript', `Transcript: ${videoTitle}`, ...);

// After: sourceNodeType パラメータで可変
sourceNode = await store.addNode(sourceNodeType, sourceTitle, ...);
//   'Video' | 'ChatRoom' | 'Document'
contentBodyNode = await store.addNode('ContentBody', `Content: ${sourceTitle}`, ...);
//   Transcript → ContentBody に統一

// Segment ノードの properties も汎用化
{
  start_ms: seg.start_ms,
  end_ms: seg.end_ms,
  sequence_index: seg.sequence_index,
  speaker: seg.speaker,
  source_id: sourceNode.id,      // was video_id
  source_title: sourceTitle,     // was video_title
}
```

### 6.3 PipelineResult 変更

```typescript
export interface PipelineResult {
  sourceNodeId: string;       // was videoNodeId
  contentBodyNodeId: string;  // was transcriptNodeId
  segmentCount: number;
  conceptCount: number;
  topicCount: number;
  flowCount: number;
  embeddingCount: number;
  contentHash: string;

  // 後方互換（deprecated）
  /** @deprecated Use sourceNodeId */
  videoNodeId: string;
  /** @deprecated Use contentBodyNodeId */
  transcriptNodeId: string;
}
```

> **方針**: `runPipelineFromSegments` 内で両フィールドに同値を設定する。
> `runPipeline` ラッパーの返り値もそのまま互換。

### 6.4 KnowledgeNodeType 追加

```typescript
// Before
export type KnowledgeNodeType = 'Video' | 'Transcript' | 'Segment' | 'Topic' | 'Concept' | 'NarrativeFlow';

// After
export type KnowledgeNodeType =
  | 'Video' | 'ChatRoom' | 'Document'  // source types
  | 'Transcript' | 'ContentBody'       // content body (Transcript is deprecated alias)
  | 'Segment' | 'Topic' | 'Concept' | 'NarrativeFlow';
```

### 6.5 schema/nodes.ts 型定義更新

**ファイル**: `packages/knowledge-engine/src/schema/nodes.ts`

```typescript
// Before
export interface VideoNodeProps {
  source_id: string;
  description: string | null;
  duration_seconds: number | null;
}
export interface TranscriptNodeProps {
  video_id: string;
  language: string;
  type: string;
  segment_count: number;
}
export interface SegmentNodeProps {
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  video_id: string;
  video_title: string;
}

// After
export interface SourceNodeProps {
  source_id: string;
  description: string | null;
  duration_seconds: number | null;  // video only
  source_type: string;              // 🆕
}
/** @deprecated Use SourceNodeProps */
export type VideoNodeProps = SourceNodeProps;

export interface ContentBodyNodeProps {
  source_id: string;               // was video_id
  language: string;
  type: string;
  segment_count: number;
}
/** @deprecated Use ContentBodyNodeProps */
export type TranscriptNodeProps = ContentBodyNodeProps;

export interface SegmentNodeProps {
  start_ms: number;
  end_ms: number;
  sequence_index: number;
  speaker: string | null;
  source_id: string;                // was video_id
  source_title: string;             // was video_title
}
```

### 6.6 context-resolver 変更

```typescript
// BASE_TYPE_WEIGHTS に新タイプ追加
const BASE_TYPE_WEIGHTS: Record<KnowledgeNodeType, number> = {
  Segment: 1.0,
  Video: 0.9,
  ChatRoom: 0.9,
  Document: 0.9,
  Topic: 0.7,
  Concept: 0.5,
  NarrativeFlow: 0.3,
  Transcript: 0.2,
  ContentBody: 0.2,
};
```

### 6.6 SourceType → NodeType マッピング

```typescript
// packages/backend/src/services/ingest.service.ts (or shared utility)
export function sourceTypeToNodeType(sourceType: SourceType): string {
  switch (sourceType) {
    case 'vimeo':
    case 'youtube':
      return 'Video';
    case 'chatwork':
      return 'ChatRoom';
    case 'text':
      return 'Document';
  }
}
```

---

## 7. Phase 5: API エンドポイント

### 7.1 新エンドポイント体系

**ファイル**: `packages/backend/src/controllers/source.controller.ts`

```
GET    /api/sources                    ← 全ソース一覧
GET    /api/sources/:id                ← ソース詳細
POST   /api/sources                    ← ソース登録 (vimeo/youtube/chatwork)
POST   /api/sources/upload             ← テキストファイルアップロード
DELETE /api/sources/:id                ← ソース削除
POST   /api/sources/:id/ingest         ← 取り込み開始
GET    /api/sources/:id/ingest/status  ← 取り込み状態

# 後方互換（既存フロントエンドが移行完了するまで維持）
GET    /api/videos                     → /api/sources にリダイレクト
POST   /api/videos                     → /api/sources にリダイレクト
```

### 7.2 バリデーションスキーマ

```typescript
const createSourceSchema = z.object({
  source_type: z.enum(['vimeo', 'youtube', 'chatwork', 'text']),
  source_id: z.string().min(1),
  title: z.string().optional().default(''),
  source_name: z.string().optional(),
});
```

### 7.3 テキストアップロードエンドポイント

```typescript
// POST /api/sources/upload
// Content-Type: multipart/form-data
// Fields: file (required), title (optional)

router.post('/api/sources/upload', upload.single('file'), async (req, res, next) => {
  // 1. ファイル保存
  // 2. content_sources レコード作成 (source_type='text', source_id=filename)
  // 3. 自動ingest開始
  // 4. レスポンス返却
});
```

---

## 8. Phase 6: フロントエンド

### 8.1 ルーティング変更

```tsx
// App.tsx
<Routes>
  <Route path="/" element={<Navigate to="/chat" replace />} />
  <Route path="/chat" element={<ChatPage />} />
  <Route path="/chat/:sessionId" element={<ChatPage />} />
  <Route path="/sources" element={<SourcesPage />} />
  <Route path="/sources/:id" element={<SourceDetailPage />} />
  {/* 後方互換 */}
  <Route path="/videos" element={<Navigate to="/sources" replace />} />
  <Route path="/videos/:id" element={<Navigate to="/sources/:id" replace />} />
</Routes>
```

### 8.2 Sidebar 変更

```tsx
const navItems = [
  { path: '/chat', label: 'Chat', icon: <ChatIcon /> },
  { path: '/sources', label: 'Sources', icon: <SourceIcon /> },
];
```

### 8.3 AddSourceDialog

ソースタイプ選択に応じて入力UIを切り替え:

| ソースタイプ | 入力UI |
|------------|-------|
| YouTube | URL or Video ID テキストフィールド |
| Vimeo | Video ID テキストフィールド |
| テキスト | ファイルアップロード (.txt, .md, .csv) |
| Chatwork | Room ID テキストフィールド |

### 8.4 SourceCard

コンテンツタイプに応じたアイコン:

| content_type | アイコン |
|-------------|---------|
| video | VideocamIcon |
| chat | ChatIcon |
| document | DescriptionIcon |

### 8.5 チャットUI — SourceCard (chat/SourceCard.tsx)

```tsx
// Before: 常にビデオカメラアイコン + タイムスタンプ表示
// After:  source_type に応じたアイコン + タイムスタンプは動画のみ表示

function SourceCard({ source }) {
  // source_type が未定義の場合は 'video' にフォールバック（既存データ後方互換）
  const icon = getSourceIcon(source.source_type ?? 'video');
  const showTimestamp = source.timestamp_ms > 0;

  return (
    <Box>
      {icon}
      <Typography>{source.source_title}</Typography>
      {showTimestamp && <Chip label={formatTime(source.timestamp_ms)} />}
      <Typography>{source.segment_text}</Typography>
    </Box>
  );
}
```

### 8.6 ChatService 汎用化

**変更点1: buildContext のproperties参照キー変更** (chat.service.ts:77-78)

```typescript
// Before
const videoTitle = (props.video_title as string) || 'Unknown';
const videoId = (props.video_id as string) || '';

// After
const sourceTitle = (props.source_title as string) || 'Unknown';
const sourceId = (props.source_id as string) || '';
const sourceType = (props.source_type as string) || 'video';
```

**変更点2: ソース情報の構築** (chat.service.ts:83-89)

```typescript
// Before
parts.push(`[${videoTitle} @ ${timestamp}]: ${text}`);
sources.push({
  video_id: videoId,
  video_title: videoTitle,
  timestamp_ms: startMs,
  segment_text: text.slice(0, 200),
});

// After
const label = startMs > 0
  ? `[${sourceTitle} @ ${timestamp}]`
  : `[${sourceTitle}]`;
parts.push(`${label}: ${text}`);
sources.push({
  source_id: sourceId,
  source_title: sourceTitle,
  source_type: sourceType,
  timestamp_ms: startMs,
  segment_text: text.slice(0, 200),
});
```

**変更点3: プロンプト汎用化**

```typescript
// Before
return `以下の動画の文字起こしに基づいて...`;

// After
return `以下のナレッジベースの情報に基づいて...`;
```

---

## 9. 実装順序（DAG）

```
[1] DB Migration ──────────────┐
[2] Shared Types ──────────────┤
                               ├── [3] Backend Services
                               │       ├── ContentSourceService IF
                               │       ├── Vimeo/YouTube アダプタ化
                               │       ├── TextSourceService
                               │       └── ChatworkSourceService (stub)
                               │
                               ├── [4] Knowledge Engine
                               │       ├── runPipelineFromSegments
                               │       ├── graph-builder 汎用化
                               │       └── schema/nodes.ts 更新
                               │
                               ├── [5] Backend Controller/Repository
                               │       ├── ContentSourceRepository
                               │       ├── SourceController
                               │       ├── IngestService 汎用化
                               │       └── ChatService プロンプト変更
                               │
                               └── [6] Frontend
                                       ├── API / Hooks
                                       ├── Pages (Sources, SourceDetail)
                                       ├── Components (AddSource, SourceCard, SourceList)
                                       └── App.tsx / Sidebar 更新
```

**依存関係**:
- [1] [2] は並行実行可能
- [1] 完了後: **マイグレーション検証**（データ整合性テスト、knowledge_nodes / chat_messages のJSONBキー確認）
- [3] [4] は [1] [2] 完了後に並行実行可能
- [5] は [3] [4] 完了後
- [5] 完了後: **結合テスト**（既存Vimeo/YouTube ingestの動作確認）
- [6] は [5] 完了後（APIに依存）
- [6] 完了後: **E2Eテスト**（全ソースタイプの登録・ingest・チャット参照）

> **注意**: [5] ChatService の `buildContext` は knowledge_nodes の properties キー名（`source_id`/`source_title`）に依存するため、[1] のJSONB移行が完了していることが前提。

---

## 10. 後方互換性の考慮

### 10.1 API後方互換

| 旧エンドポイント | 対応 |
|----------------|------|
| `GET /api/videos` | `/api/sources` にリダイレクト |
| `POST /api/videos` | `/api/sources` にリダイレクト |
| その他 `/api/videos/*` | 同パターンでリダイレクト |

### 10.2 型の後方互換

| 旧型 | 対応 |
|-----|------|
| `Video` | `ContentSource` の deprecated alias |
| `VideoSourceType` | `SourceType` の deprecated alias |
| `IngestResult.video_id` | `IngestResult.source_id` に変更 |
| `ChatSource.video_id` | `ChatSource.source_id` に変更 |

### 10.3 DB後方互換

- `videos` テーブルは `content_sources` にリネーム
- `ingest_log.video_id` は `source_id` にリネーム
- knowledge_nodes の JSONB 内キーも移行

### 10.4 knowledge_nodes 後方互換

- `Video` ノードタイプはそのまま維持
- `Transcript` ノードタイプは維持（新規は `ContentBody`）
- Segment の properties 内 `video_id` → `source_id`, `video_title` → `source_title`

---

## 11. 検証方法

### 11.1 マイグレーション検証

```bash
docker compose -f deploy/docker-compose.yml up
# → マイグレーション自動実行
# → content_sources テーブルが存在すること
# → 既存データが移行されていること
```

### 11.2 機能テスト

| テスト項目 | 手順 | 期待結果 |
|-----------|------|---------|
| 既存Vimeo動画の表示 | GET /api/sources | 既存の動画が一覧に表示 |
| YouTube動画の追加 | POST /api/sources {source_type: 'youtube', source_id: '...'} | 正常に登録 |
| 動画のingest | POST /api/sources/:id/ingest | 7ステージ完了 |
| テキストファイルアップロード | POST /api/sources/upload (multipart) | 自動ingest完了 |
| チャットでの参照 | POST /api/chat {message: '...'} | ソースが引用される |
| 後方互換API | GET /api/videos | /api/sources にリダイレクト |
| フロントエンド表示 | /sources ページ | 全ソースタイプ表示 |

### 11.3 非破壊確認

- 既存のknowledge_nodesデータが損なわれていないこと
- 既存のチャットセッションが正常に動作すること
- 既存のingest_logが参照可能であること

---

## 12. リスクと対策

| リスク | 影響 | 対策 |
|-------|------|------|
| マイグレーション失敗 | DBが不整合 | TRANSACTIONで囲む + DOWN migration準備 |
| 後方互換漏れ | 既存機能が壊れる | deprecated alias + リダイレクト |
| knowledge_nodes JSONB移行漏れ | グラフ検索精度低下 | 移行SQLで全件更新 + 検証クエリ |
| フロントエンド型不一致 | コンパイルエラー | shared型から段階的移行 |

---

## 13. 将来拡張

この設計により、新しいソースの追加は以下の手順のみ:

1. `SourceType` に新値追加 (`content-source.ts`)
2. `ContentSourceService` の新実装クラス作成
3. `IngestService` のソースMapに登録
4. `sourceTypeToNodeType` のswitch分岐追加
5. `KnowledgeNodeType` に新ノードタイプ追加 (`schema/nodes.ts`)
6. `BASE_TYPE_WEIGHTS` / `INTENT_ADJUSTMENTS` に新タイプのweight追加 (`context-resolver.ts`)
7. フロントエンドのAddSourceDialogに入力UIを追加
8. DBの `chk_source_type` 制約に新値追加（マイグレーション）

パイプライン（Stage 3-7 の概念抽出・コミュニティ検出・フロー検出・embedding生成）、検索エンジン、チャットサービスは**変更不要**。
