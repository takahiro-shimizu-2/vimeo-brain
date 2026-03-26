# YouTube対応 — マルチソース動画取り込み設計ドキュメント

> vimeo-brainをVimeo専用からマルチソース（Vimeo + YouTube）対応に拡張する

## 1. 背景と目的

### 1.1 現状

vimeo-brainは現在Vimeo APIに完全依存している:

| 層 | Vimeo依存箇所 |
|----|---------------|
| DB | `videos.vimeo_id` カラム（VARCHAR） |
| 共有型 | `Video.vimeo_id` フィールド |
| Backend | `VimeoService` がトランスクリプト・メタデータ取得を担当 |
| Knowledge Engine | `runPipeline(vimeoId, ...)` / `VideoNodeProps.vimeo_id` |
| Frontend | AddVideoDialogで `vimeo_id` を入力、表示にも使用 |

### 1.2 目的

- YouTube公開動画の字幕を取り込めるようにする
- APIキーなし（公開動画）とAPIキーあり（メタデータ充実）の両方に対応
- 既存のVimeo取り込みパイプラインを壊さない
- 将来的に他ソース（Twitch等）追加時の拡張ポイントを用意する

### 1.3 影響範囲（変更しないもの）

Knowledge Engineパイプラインの7ステージは**ソース非依存**であり、変更不要:

```
VTT Parse → Segment Build → Concept Extract → Graph Build
→ Community Detect → Flow Detect → Embedding Gen
```

以下も変更しない:
- 検索層（Context Resolver, hybridSearch, MCPツール）
- チャットサービス（`chat.service.ts`）
- knowledge_nodes / knowledge_edges テーブル構造（ただし既存Videoノードの `properties` JSONB内キー名は移行する）

---

## 2. 設計

### 2.1 データモデル変更

#### Before
```
videos
├── id (UUID, PK)
├── vimeo_id (VARCHAR)  ← Vimeo専用
├── title, description, duration_seconds, thumbnail_url
├── content_hash, ingest_status
└── created_at, updated_at
```

#### After
```
videos
├── id (UUID, PK)
├── source_type (VARCHAR(20), NOT NULL, DEFAULT 'vimeo')  ← NEW
├── source_id (VARCHAR(50), NOT NULL)                      ← RENAMED from vimeo_id
├── title, description, duration_seconds, thumbnail_url
├── content_hash, ingest_status
├── created_at, updated_at
├── UNIQUE(source_type, source_id)  ← NEW
└── CHECK(source_type IN ('vimeo', 'youtube'))  ← NEW
```

#### マイグレーション戦略

1. `source_type` カラム追加（DEFAULT 'vimeo' で既存行を自動補完）
2. `source_id` カラム追加、`vimeo_id` の値をコピー
3. `source_id` に NOT NULL 制約追加
4. ユニーク制約・CHECK制約・インデックス追加
5. `vimeo_id` カラム削除

```sql
-- db/migrations/20260327000001_add_source_type.sql
-- migrate:up

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

-- migrate:down
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
```

### 2.2 共有型定義

```typescript
// packages/shared/src/types/video.ts
export type VideoSourceType = 'vimeo' | 'youtube';

export interface Video {
  id: string;
  source_type: VideoSourceType;  // NEW
  source_id: string;             // RENAMED from vimeo_id
  title: string;
  description: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  content_hash: string | null;
  ingest_status: IngestStatus;
  created_at: Date;
  updated_at: Date;
}
```

### 2.3 VideoSourceService パターン（Strategy）

ソースごとの差異を吸収するインターフェースを導入:

```
                 ┌─────────────────────┐
                 │  VideoSourceService  │ ← interface
                 │  (video-source.ts)   │
                 ├─────────────────────┤
                 │ getMetadata()        │
                 │ getTranscriptVtt()   │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │                           │
    ┌─────────▼─────────┐     ┌──────────▼──────────┐
    │   VimeoService     │     │  YouTubeService      │
    │ (vimeo.service.ts) │     │ (youtube.service.ts)  │
    └────────────────────┘     └───────────────────────┘
```

#### インターフェース定義

```typescript
// packages/backend/src/services/video-source.ts
export interface VideoMetadata {
  title: string;
  description: string | null;
  duration_seconds: number;
  thumbnail_url: string | null;
}

export interface VideoSourceService {
  getMetadata(sourceId: string): Promise<VideoMetadata>;
  getTranscriptVtt(sourceId: string): Promise<string>;
}
```

#### YouTubeService実装

```typescript
// packages/backend/src/services/youtube.service.ts
import { YoutubeTranscript } from 'youtube-transcript';

export class YouTubeService implements VideoSourceService {
  async getTranscriptVtt(videoId: string): Promise<string> {
    // youtube-transcript パッケージで字幕テキスト取得
    // → VTT形式に変換して返す
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    return this.toVtt(items);
  }

  async getMetadata(videoId: string): Promise<VideoMetadata> {
    // YOUTUBE_API_KEY あり → Data API v3 で詳細メタデータ
    // YOUTUBE_API_KEY なし → サムネイルURLのみ（oembed API）
  }
}
```

**依存パッケージ**: `youtube-transcript` (APIキー不要で公開動画の字幕を取得)

#### VimeoService変更

既存 `VimeoService` に `implements VideoSourceService` を追加。
既存メソッド(`getVideo`, `getTextTracks`, `downloadVtt`)はそのまま残し、
`getMetadata()` / `getTranscriptVtt()` をラッパーとして追加:

```typescript
export class VimeoService implements VideoSourceService {
  // 既存メソッドはそのまま

  async getMetadata(vimeoId: string): Promise<VideoMetadata> {
    const v = await this.getVideo(vimeoId);
    return {
      title: v.name,
      description: v.description,
      duration_seconds: v.duration,
      thumbnail_url: v.pictures.sizes[v.pictures.sizes.length - 1]?.link ?? null,
    };
  }

  async getTranscriptVtt(vimeoId: string): Promise<string> {
    const tracks = await this.getTextTracks(vimeoId);
    if (tracks.length === 0) throw new Error('No text tracks found');
    return this.downloadVtt(tracks[0].link);
  }
}
```

### 2.4 IngestService リファクタ

ソース振り分けロジックを追加:

```typescript
export class IngestService {
  private sources: Map<VideoSourceType, VideoSourceService>;

  constructor(pool: Pool) {
    this.sources = new Map([
      ['vimeo', new VimeoService()],
      ['youtube', new YouTubeService()],
    ]);
    // ...
  }

  async ingest(videoId: string): Promise<IngestResult> {
    const video = await this.videoRepo.findById(videoId);
    const source = this.sources.get(video.source_type);
    if (!source) throw new Error(`Unknown source: ${video.source_type}`);

    // source.getTranscriptVtt(video.source_id) で字幕取得
    // source.getMetadata(video.source_id) でメタデータ取得
    // あとは既存パイプラインと同じ
  }
}
```

### 2.5 Repository変更

```typescript
// Before
findByVimeoId(vimeoId: string): Promise<Video | null>
create(vimeoId: string, title: string): Promise<Video>

// After
findBySourceId(sourceType: VideoSourceType, sourceId: string): Promise<Video | null>
create(sourceType: VideoSourceType, sourceId: string, title: string): Promise<Video>
```

### 2.6 Controller / API変更

```
// Before: POST /api/videos
{ "vimeo_id": "123456" }

// After: POST /api/videos
{ "source_type": "vimeo", "source_id": "123456" }
{ "source_type": "youtube", "source_id": "dQw4w9WgXcQ" }
```

後方互換: `source_type` はデフォルト `'vimeo'` なので、省略時はVimeo扱い。

### 2.7 Knowledge Engine パラメータ名変更（コスメ）

| ファイル | Before | After |
|---------|--------|-------|
| `pipeline/index.ts` | `runPipeline(vimeoId, ...)` | `runPipeline(videoSourceId, ...)` |
| `pipeline/graph-builder.ts` | `{ vimeo_id: videoId }` | `{ source_id: videoId }` |
| `schema/nodes.ts` | `VideoNodeProps.vimeo_id` | `VideoNodeProps.source_id` |

ログメッセージの `vimeoId` も `videoSourceId` に統一。

### 2.8 Frontend変更

#### AddVideoDialog

Vimeo/YouTubeの選択UIを追加:

```
┌─────────────────────────────────┐
│  Add Video                      │
│                                 │
│  Source: [Vimeo ▼] [YouTube]    │  ← ToggleButtonGroup
│                                 │
│  ┌───────────────────────────┐  │
│  │ YouTube URL or Video ID   │  │  ← source_type に応じてラベル変化
│  │ https://youtu.be/...      │  │
│  └───────────────────────────┘  │
│                                 │
│           [Cancel] [Add]        │
└─────────────────────────────────┘
```

YouTube URL解析ロジック（フロントエンド側）:
- `https://www.youtube.com/watch?v=VIDEO_ID` → `VIDEO_ID`
- `https://www.youtube.com/watch?v=VIDEO_ID&t=120` → `VIDEO_ID`（パラメータ除去）
- `https://youtu.be/VIDEO_ID` → `VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID` → `VIDEO_ID`
- `https://www.youtube.com/v/VIDEO_ID` → `VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID` → `VIDEO_ID`（モバイル）
- `VIDEO_ID` (11文字の直接入力) → そのまま

#### VideoCard / VideoDetailPage

`vimeo_id` → `source_id` に変更し、`source_type` に応じた表示:
- Vimeo: `Vimeo: 123456`
- YouTube: `YouTube: dQw4w9WgXcQ`

#### videos.api.ts

```typescript
// Before
create: (vimeoId: string) => api.post('/videos', { vimeo_id: vimeoId })

// After
create: (sourceType: VideoSourceType, sourceId: string) =>
  api.post('/videos', { source_type: sourceType, source_id: sourceId })
```

---

## 3. 変更ファイル一覧

| # | ファイル | 区分 | 変更概要 |
|---|---------|------|---------|
| 1 | `db/migrations/20260327000001_add_source_type.sql` | 新規 | source_type + source_id カラム追加、vimeo_id削除 |
| 2 | `packages/shared/src/types/video.ts` | 修正 | `VideoSourceType`型追加、`Video`インターフェース更新 |
| 3 | `packages/backend/src/config.ts` | 修正 | `YOUTUBE_API_KEY` optional追加 |
| 4 | `packages/backend/package.json` | 修正 | `youtube-transcript` 依存追加 |
| 5 | `packages/backend/src/services/video-source.ts` | 新規 | `VideoSourceService` インターフェース定義 |
| 6 | `packages/backend/src/services/youtube.service.ts` | 新規 | YouTube字幕・メタデータ取得 |
| 7 | `packages/backend/src/services/vimeo.service.ts` | 修正 | `implements VideoSourceService` + ラッパー追加 |
| 8 | `packages/backend/src/repositories/video.repository.ts` | 修正 | `findBySourceId` / `create` シグネチャ変更 |
| 9 | `packages/backend/src/services/ingest.service.ts` | 修正 | ソース振り分けMap + `source_id`参照 |
| 10 | `packages/backend/src/controllers/video.controller.ts` | 修正 | リクエストスキーマ変更 |
| 11 | `packages/backend/src/controllers/webhook.controller.ts` | 修正 | `findBySourceId('vimeo', ...)` |
| 12 | `packages/backend/src/services/polling.service.ts` | 修正 | ログフィールド `vimeoId` → `sourceId` |
| 13 | `packages/knowledge-engine/src/pipeline/index.ts` | 修正 | パラメータ名 `vimeoId` → `videoSourceId` |
| 14 | `packages/knowledge-engine/src/pipeline/graph-builder.ts` | 修正 | `vimeo_id` → `source_id` プロパティ |
| 15 | `packages/knowledge-engine/src/schema/nodes.ts` | 修正 | `VideoNodeProps.vimeo_id` → `source_id` |
| 16 | `packages/knowledge-engine/src/index.ts` | 確認 | `runPipeline` re-export（シグネチャ自動追従） |
| 17 | `packages/frontend/src/api/videos.api.ts` | 修正 | 型 + create引数 |
| 18 | `packages/frontend/src/components/video/AddVideoDialog.tsx` | 修正 | ソース選択UI + URL解析 |
| 19 | `packages/frontend/src/components/video/VideoCard.tsx` | 修正 | 表示テキスト |
| 20 | `packages/frontend/src/pages/VideoDetailPage.tsx` | 修正 | 表示テキスト |
| 21 | `packages/frontend/src/hooks/useVideos.ts` | 修正 | addVideo引数 |

---

## 4. 依存関係（実装順序）

```
Step 1: DB Migration ─────────────┐
Step 2: Shared Types ─────────────┤
Step 3: Config + Dependencies ────┤
                                  ├──→ Step 5: Repository
Step 4: VideoSourceService        │        │
        + YouTubeService          │        ▼
        + VimeoService改修 ───────┴──→ Step 6: IngestService
                                           │
                                           ▼
Step 7: Knowledge Engine ──────────→ Step 8: Controllers
(独立、並行可能)                            │
                                           ▼
                                   Step 9: Frontend
```

Step 1〜4 と Step 7 は並行実行可能。

---

## 5. YouTube字幕取得の技術詳細

### 5.1 `youtube-transcript` パッケージ

| 項目 | 内容 |
|------|------|
| バージョン | v1.3.0 (2026-03-13) |
| 週間DL | ~90,000 |
| TypeScript型 | 内蔵（`@types` 不要） |
| 外部依存 | なし（v1.3.0で `phin` 依存を削除、`fetch` APIに移行） |
| 取得方式 | InnerTube API (Android偽装) → HTMLスクレイピング (フォールバック) |
| 返り値 | `TranscriptResponse[]` = `{ text: string, duration: number, offset: number, lang?: string }[]` |

### 5.2 VTT変換 + 単位正規化

`youtube-transcript` には**取得経路による単位不整合**がある:

| 取得経路 | `offset` / `duration` の単位 |
|---------|---------------------------|
| InnerTube API (srv3フォーマット) | **ミリ秒** |
| HTMLスクレイピング (classicフォーマット) | **秒** |

型定義上は `number` で統一されており判別不能。VTT変換時にタイムスタンプが壊れるリスクがある。

**対策**: `toVtt()` 内で単位を正規化するヒューリスティックを適用:

```typescript
/** offset/duration の単位を秒に正規化 */
private normalizeToSeconds(items: TranscriptResponse[]): TranscriptResponse[] {
  // 最初のアイテムの offset が 1000 以上ならミリ秒とみなす
  // （通常の動画で最初の字幕が1000秒=16分以降に始まることは稀）
  const isMillis = items.length > 0 && items[0].offset > 1000;
  if (!isMillis) return items;
  return items.map(item => ({
    ...item,
    offset: item.offset / 1000,
    duration: item.duration / 1000,
  }));
}

private toVtt(items: TranscriptResponse[]): string {
  const normalized = this.normalizeToSeconds(items);
  let vtt = 'WEBVTT\n\n';
  for (const item of normalized) {
    const start = this.formatTimestamp(item.offset);
    const end = this.formatTimestamp(item.offset + item.duration);
    vtt += `${start} --> ${end}\n${item.text}\n\n`;
  }
  return vtt;
}
```

### 5.3 メタデータ取得（2パターン）

| 条件 | 方法 | 取得情報 |
|------|------|---------|
| `YOUTUBE_API_KEY` あり | YouTube Data API v3 `/videos?part=snippet,contentDetails` | title, description, duration, thumbnail |
| `YOUTUBE_API_KEY` なし | YouTube公式 oEmbed API (`youtube.com/oembed?url=...&format=json`) | title, thumbnail のみ |

**注意**: oEmbedはYouTube公式エンドポイントを使用する（サードパーティサービス `noembed.com` への依存を避ける）。

---

## 6. 検証手順

```bash
# 1. マイグレーション実行
npx dbmate -d db/migrations up

# 2. ビルド確認（全パッケージ）
npm run build --workspace=packages/shared
npm run build --workspace=packages/knowledge-engine
npm run build --workspace=packages/backend
npm run build --workspace=packages/frontend

# 3. YouTube動画取り込みテスト（公開動画）
curl -X POST http://localhost:3001/api/videos \
  -H 'Content-Type: application/json' \
  -d '{"source_type":"youtube","source_id":"dQw4w9WgXcQ"}'

curl -X POST http://localhost:3001/api/videos/{id}/ingest

# 4. 取り込み後チャットテスト
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"この動画では何について話していますか？"}'

# 5. 既存Vimeo取り込みが壊れていないこと確認
curl -X POST http://localhost:3001/api/videos \
  -H 'Content-Type: application/json' \
  -d '{"source_type":"vimeo","source_id":"123456"}'
```

---

## 7. リスク・注意事項

| リスク | 影響 | 対策 |
|--------|------|------|
| `youtube-transcript` はスクレイピングベース | YouTube側変更で壊れる可能性 | エラーハンドリング + フォールバックメッセージ |
| **クラウド環境でのYouTubeブロック** | **Vercel/AWS Lambda/Cloud Run等でIP制限される** | **プロキシ経由 or `config.fetch` にカスタムfetch注入** |
| `offset`/`duration` 単位不整合 | VTTタイムスタンプ破損 | `normalizeToSeconds()` ヒューリスティック（5.2節参照） |
| 字幕なし動画 | ingest失敗 | 明確なエラーメッセージ「字幕が見つかりません」 |
| DB破壊的マイグレーション | `vimeo_id` 削除 + knowledge_nodes JSONB移行 | migrate:down で復元可能、事前バックアップ推奨 |
| YouTube Data API クォータ | 1日10,000ユニット | APIキーなしモードで回避可能 |
