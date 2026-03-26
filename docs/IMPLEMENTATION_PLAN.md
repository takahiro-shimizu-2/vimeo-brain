# vimeo-brain 実装計画

## 概要

Vimeo動画の文字起こしを自動取り込みし、ナレッジグラフとして構造化・インデックス化して、チャットボットで的確に質問回答するシステム。

**核心**: GitNexusがコードをグラフ化するのと同じアーキテクチャ（LadybugDB、Louvain、BFS、BM25+semantic hybrid search）で、文字起こしデータをナレッジグラフ化する**新しいエンジン**を作る。GitNexusは一切変更しない。

## アーキテクチャ

```
Vimeo API → VTT取得 → Knowledge Engine（LadybugDB グラフ）→ Hybrid Search → LLM → Chat応答
                              ↑
                    新規パッケージ: @vimeo-brain/knowledge-engine
                    GitNexusと同じDB技術、別のスキーマ
```

### デプロイ先

**Docker + GCP（Google Cloud Platform）**

| コンポーネント | ローカル | GCP本番 |
|--------------|---------|---------|
| Backend | Docker Compose | Cloud Run |
| Frontend | Docker Compose | Cloud Run（静的配信）or Cloud Storage + CDN |
| PostgreSQL | pgvector/pgvector:pg16 コンテナ | Cloud SQL for PostgreSQL（pgvector拡張） |
| Knowledge Data | Docker Volume | Cloud Storage FUSE マウント（`/mnt/knowledge`） |
| Container Registry | — | Artifact Registry |
| CI/CD | — | Cloud Build |
| Secrets | `.env` | Secret Manager |
| Monitoring | — | Cloud Logging + Cloud Monitoring |

### モノレポ構成

```
vimeo-brain/
├── packages/
│   ├── shared/             # @vimeo-brain/shared（共有型定義）
│   ├── knowledge-engine/   # @vimeo-brain/knowledge-engine（ナレッジグラフエンジン）
│   ├── backend/            # Express API（3層アーキテクチャ）
│   └── frontend/           # React Chat UI（MUI v7, Vite 7）
├── deploy/
│   ├── docker-compose.yml  # ローカル開発用（pgvector, backend, frontend）
│   ├── Dockerfile.backend  # Backend用マルチステージビルド
│   ├── Dockerfile.frontend # Frontend用マルチステージビルド（nginx）
│   └── cloudbuild.yaml     # Cloud Build CI/CDパイプライン
├── db/
│   └── migrations/         # SQLマイグレーション（dbmate）
└── docs/                   # ドキュメント
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| Backend | TypeScript, Express.js, PostgreSQL + pgvector, Pino, Zod |
| Frontend | React 19, MUI v7, Vite 7, React Router v7 |
| Knowledge Engine | LadybugDB, graphology (Louvain), BM25+semantic hybrid |
| Vimeo API | `@vimeo/vimeo`、`/videos/{id}/texttracks` |
| RAG | pgvector ベクトル検索 → LLM（Claude/OpenAI切替可能） |
| DB | PostgreSQL 16 + pgvector拡張 |
| インフラ | Docker, GCP（Cloud Run, Cloud SQL, Artifact Registry, Cloud Build） |

---

## Phase 1: 基盤（モノレポ構造 + 共有型 + DB + Express骨格）

### 1.1 ルート設定更新

| ファイル | 変更内容 |
|---------|---------|
| `package.json` | workspacesに4パッケージ追加 |
| `tsconfig.base.json`（新規） | 共有TSコンパイラ設定 |

```json
// package.json workspaces
"workspaces": ["packages/shared", "packages/knowledge-engine", "packages/backend", "packages/frontend"]
```

### 1.2 共有型（`packages/shared/`）

```
packages/shared/
  package.json          # @vimeo-brain/shared
  tsconfig.json
  src/
    index.ts            # 再エクスポート
    types/
      video.ts          # Video, IngestStatus, IngestResult
      chat.ts           # ChatMessage, ChatSession, ChatRequest, ChatResponse, ChatSource
      ingest.ts         # IngestLog
      knowledge.ts      # KnowledgeSegment, KnowledgeTopic, KnowledgeConcept
      api.ts            # ApiResponse<T>, PaginatedResponse<T>
```

### 1.3 PostgreSQL + マイグレーション

**Docker**: `deploy/docker-compose.yml` — pgvector/pgvector:pg16

**マイグレーション**:

| ファイル | 内容 |
|---------|------|
| `20260326000001_initial_schema.sql` | videos, chat_sessions, chat_messages, ingest_log テーブル |
| `20260326000002_pgvector.sql` | pgvector拡張 + segment_embeddings テーブル |

**テーブル設計**:

- `videos` — vimeo_id (UNIQUE), title, description, duration_seconds, thumbnail_url, content_hash, ingest_status, timestamps
- `chat_sessions` — id, title, timestamps
- `chat_messages` — session_id FK, role (user/assistant), content, sources (JSONB), timestamps
- `ingest_log` — video_id FK, content_hash, segment_count, status, error_message, timestamps

### 1.4 Backend骨格（`packages/backend/`）

```
packages/backend/
  package.json
  tsconfig.json
  src/
    index.ts              # サーバー起動
    app.ts                # Express app factory
    config.ts             # Zod環境変数バリデーション
    errors/app-error.ts   # AppErrorクラス
    utils/logger.ts       # Pinoロガー
    middleware/
      error-handler.ts    # グローバルエラーハンドラ
      request-logger.ts   # Pinoリクエストログ
      validate.ts         # Zodバリデーションミドルウェア
    controllers/
      health.controller.ts  # GET /health, GET /readiness
    repositories/
      video.repository.ts   # PostgreSQL CRUD
      chat.repository.ts    # PostgreSQL CRUD
```

**依存関係**: express, pg, pino, pino-http, zod, uuid, cors, dotenv

### Phase 1 検証

```bash
docker compose -f deploy/docker-compose.yml up -d postgres
npx dbmate -d db/migrations up
cd packages/backend && npm run dev
curl http://localhost:3001/health
curl http://localhost:3001/readiness
```

---

## Phase 2: Knowledge Engine + Vimeo取り込み

### 2.1 Knowledge Engine（`packages/knowledge-engine/`）

GitNexusのアーキテクチャを踏襲した文字起こしナレッジグラフエンジン。

#### グラフスキーマ

**ノードタイプ**:

| Node | プロパティ | 説明 |
|------|----------|------|
| Video | vimeo_id, title, description, duration_seconds, content_hash | 動画 |
| Transcript | language, type, content_hash, segment_count | 文字起こしファイル |
| Segment | text, start_ms, end_ms, sequence_index, speaker | テキスト断片 |
| Topic | label, keywords, description, cohesion, segment_count | トピッククラスタ（Louvain） |
| Concept | name, type, description, mention_count | 抽出された概念・エンティティ |
| NarrativeFlow | label, flow_type, step_count, topics | 語りの流れ（実行フロー相当） |

**エッジタイプ**（単一`KnowledgeRelation`テーブル、GitNexusの`CodeRelation`と同パターン）:

| Edge | 説明 |
|------|------|
| CONTAINS | Video→Transcript, Transcript→Segment |
| FOLLOWS | Segment→Segment（時系列順序） |
| MENTIONS | Segment→Concept |
| RELATES_TO | Concept→Concept（共起関係） |
| PART_OF_TOPIC | Segment→Topic（Louvain割当） |
| MEMBER_OF | Concept→Topic |
| STEP_IN_FLOW | Segment→NarrativeFlow（step番号付き） |
| CROSS_REFS | Segment→Segment（動画間の意味的参照） |

#### 解析パイプライン（7ステージ）

```
Stage 1: VTT Parse       → node-webvttでパース、speaker抽出
Stage 2: Segment Build    → 隣接キュー結合（2秒以内のギャップ）、content_hash生成
Stage 3: Concept Extract  → LLM（Claude/OpenAI切替）で概念・エンティティ抽出
Stage 4: Graph Build      → LadybugDBにノード+エッジ投入
Stage 5: Community Detect  → Louvain（graphology-communities-louvain）でトピッククラスタリング
Stage 6: Flow Detect      → BFSでナラティブフロー検出
Stage 7: Embedding Gen    → セグメントのベクトル埋め込み生成
```

> **注**: graphologyのLeiden実装は未公開（GitHub Issue #543）。Louvainで同等のコミュニティ検出が可能。将来Leidenが公開された場合は差し替え可能な設計にする。

#### ハイブリッド検索（RRFアルゴリズム）

- **BM25**: LadybugDB FTS（Segment.text, Concept.name）
- **Semantic**: ベクトルインデックス（cosine similarity）
- **RRF**: `score = 1 / (60 + rank + 1)` でマージ

#### 重複判定（3レベル）

| レベル | 対象 | 方法 |
|-------|------|------|
| Transcript | VTT生データ | SHA-256 → 同一VTTの再取り込み防止 |
| Segment | テキスト | SHA-256 → 異なるTranscript間の重複検出 |
| Video | 全Transcript結合テキスト | SHA-256 → 再アップロード検出 |

#### ストレージ

```
.vimeo-brain/
  lbug/           # LadybugDBグラフデータベース
  meta.json       # インデックスメタデータ
```

#### Cloud Run永続化戦略

Cloud Runはステートレスコンテナのため、`.vimeo-brain/lbug/` のファイルベースDBは再起動時に消失する。以下の方式で永続化する:

**方式: Cloud Storage FUSE マウント**

```yaml
# Cloud Runサービス設定
gcloud run deploy vimeo-brain-backend \
  --execution-environment gen2 \
  --add-volume name=knowledge-data,type=cloud-storage,bucket=vimeo-brain-knowledge \
  --add-volume-mount volume=knowledge-data,mount-path=/mnt/knowledge
```

- Knowledge Engineの `KNOWLEDGE_DATA_DIR` 環境変数で `.vimeo-brain/` の配置先を `/mnt/knowledge/` に変更
- GCSバケット `vimeo-brain-knowledge` にLadybugDBデータを永続化
- Cloud Storage FUSEはgen2実行環境で利用可能
- **フォールバック**: GCS FUSEが性能不足の場合、PostgreSQL上にグラフテーブル（nodes/edges）を実装してデータストアを一元化する案も検討可能

#### ファイル構成

```
packages/knowledge-engine/
  package.json              # @vimeo-brain/knowledge-engine
  tsconfig.json
  src/
    index.ts                # 公開API
    schema/
      nodes.ts              # ノード型定義
      edges.ts              # エッジ型定義
    parsers/
      vtt-parser.ts         # VTT→キュー配列
    pipeline/
      index.ts              # パイプラインオーケストレーター
      segment-builder.ts    # キュー→セグメント
      concept-extractor.ts  # LLMで概念抽出
      graph-builder.ts      # グラフ構築
      community-detector.ts # Louvain→トピック
      flow-detector.ts      # BFS→ナラティブフロー
      embedding-generator.ts # ベクトル埋め込み
    search/
      hybrid-search.ts      # BM25+semantic+RRF
    db/
      connection.ts         # LadybugDB接続管理
    utils/
      hash.ts               # SHA-256ハッシュ
      logger.ts
```

**依存関係**: @ladybugdb/core, node-webvtt, graphology, graphology-communities-louvain, @anthropic-ai/sdk, openai, pino

### 2.2 Backend Vimeo + 取り込みサービス

```
packages/backend/src/
  services/
    vimeo.service.ts        # @vimeo/vimeoラッパー
    ingest.service.ts       # 取り込みオーケストレーション
    embedding.service.ts    # 埋め込み生成抽象化
  repositories/
    knowledge.repository.ts # KnowledgeEngineラッパー
  controllers/
    video.controller.ts     # CRUD + POST /api/videos/:id/ingest
    ingest.controller.ts    # GET /api/videos/:id/ingest/status
    webhook.controller.ts   # POST /api/webhooks/vimeo（Vimeo Webhook受信）
```

**APIエンドポイント**:

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/videos` | 動画一覧 |
| GET | `/api/videos/:id` | 動画詳細 |
| POST | `/api/videos` | 動画登録 `{ vimeo_id }` |
| DELETE | `/api/videos/:id` | 動画削除 |
| POST | `/api/videos/:id/ingest` | 取り込み開始 |
| GET | `/api/videos/:id/ingest/status` | 取り込み状況 |
| POST | `/api/webhooks/vimeo` | Vimeo Webhook受信（HMAC署名検証付き） |

#### Vimeo Webhook連携

Vimeo APIはWebhookをサポートしており、以下のイベントを購読する:

| イベント | トリガー | アクション |
|---------|---------|-----------|
| `video.upload.complete` | 動画アップロード完了 | videos テーブルに自動登録 |
| `video.text_track.complete` | 文字起こし完了 | 自動でingestパイプライン開始 |

```
Vimeo Webhook → POST /api/webhooks/vimeo
  → HMAC署名検証（VIMEO_WEBHOOK_SECRET）
  → イベント判定
    → video.upload.complete: 動画登録
    → video.text_track.complete: 自動ingest開始
```

**フォールバック**: Webhook受信不可時（ネットワーク障害等）のため、`polling.service.ts`（30分間隔）を併用する。

### Phase 2 検証

```bash
curl -X POST http://localhost:3001/api/videos -H 'Content-Type: application/json' -d '{"vimeo_id":"123456"}'
curl -X POST http://localhost:3001/api/videos/{id}/ingest
curl http://localhost:3001/api/videos/{id}/ingest/status
cat .vimeo-brain/meta.json
```

---

## Phase 3: Chat + ポーリング + Frontend + MCP

### 3.1 Chat API（RAGパイプライン）

```
packages/backend/src/
  services/
    chat.service.ts     # RAG: hybridSearch → context構築 → LLM呼出 → 応答
    llm.service.ts      # LLM抽象化（Claude/OpenAI切替）
    polling.service.ts  # 30分間隔でVimeo新動画チェック
  controllers/
    chat.controller.ts  # POST /api/chat, GET/DELETE sessions
```

**RAGフロー**:

```
1. ユーザーメッセージ受信
2. knowledge.repository.hybridSearch(message)
   → BM25 + semantic でセグメント検索
3. RRFスコアでランキング、上位K件取得
4. コンテキストウィンドウ構築
   （動画タイトル + タイムスタンプ + セグメントテキスト）
5. LLMプロンプト構築
   （システム指示 + 検索コンテキスト + ユーザー質問）
6. Claude/OpenAI呼出
7. 質問 + 回答をPostgreSQLに保存
8. ソース参照（動画タイトル、タイムスタンプ）付きで応答
```

**チャットAPIエンドポイント**:

| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/chat` | チャット送信 `{ session_id?, message }` |
| GET | `/api/chat/sessions` | セッション一覧 |
| GET | `/api/chat/sessions/:sessionId` | セッション詳細 |
| DELETE | `/api/chat/sessions/:sessionId` | セッション削除 |

### 3.2 Knowledge Engine MCP Server

GitNexusと同じMCPパターンで、Claude Codeからナレッジグラフを操作可能にする。

```
packages/knowledge-engine/src/mcp/
  mcp-server.ts         # MCPサーバーエントリポイント
  tools/
    query.ts            # knowledge_query — トピックグループ化検索
    context.ts          # knowledge_context — セグメント/概念の360度ビュー
    search.ts           # knowledge_search — チャットボット用ハイブリッド検索
    topics.ts           # knowledge_topics — トピック一覧
    flows.ts            # knowledge_flows — ナラティブフロー一覧
    cypher.ts           # knowledge_cypher — 生Cypherクエリ
    stats.ts            # knowledge_stats — 統計情報
```

### 3.3 Frontend（`packages/frontend/`）

```
packages/frontend/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    theme/theme.ts              # MUI v7テーマ
    api/
      client.ts                 # fetchラッパー
      videos.api.ts
      chat.api.ts
      sessions.api.ts
    pages/
      ChatPage.tsx              # メインチャットUI
      VideosPage.tsx            # 動画管理（一覧+追加+取り込み）
      VideoDetailPage.tsx       # 動画詳細+取り込み状況
    components/
      chat/
        ChatWindow.tsx          # メッセージリスト
        ChatInput.tsx           # 入力+送信ボタン
        ChatMessage.tsx         # メッセージバブル
        SourceCard.tsx          # ソース参照カード
      video/
        VideoList.tsx           # 動画グリッド
        VideoCard.tsx           # 動画カード
        AddVideoDialog.tsx      # Vimeo ID入力ダイアログ
        IngestStatusBadge.tsx   # ステータスバッジ
      layout/
        AppLayout.tsx           # サイドバー+メインコンテンツ
        Sidebar.tsx             # ナビゲーション
    hooks/
      useChat.ts
      useVideos.ts
      useSessions.ts
```

**依存関係**: react, react-dom, @mui/material, @emotion/react, @emotion/styled, @mui/icons-material, react-router-dom, vite

### 3.4 Docker + GCPデプロイ構成

#### ローカル開発（Docker Compose）

```yaml
# deploy/docker-compose.yml
services:
  postgres:    # pgvector/pgvector:pg16 (port 5432)
  backend:     # packages/backend (port 3001)
  frontend:    # packages/frontend (port 3000)
volumes:
  pgdata:
  knowledge-data:  # .vimeo-brain/ 永続化
```

#### Dockerfiles

```dockerfile
# deploy/Dockerfile.backend — マルチステージビルド
FROM node:20-slim AS builder
WORKDIR /app

# LadybugDB（ネイティブアドオン）のビルドに必要な依存
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/knowledge-engine/ packages/knowledge-engine/
COPY packages/backend/ packages/backend/
RUN npm ci --workspace=packages/backend
RUN npm run build --workspace=packages/shared \
 && npm run build --workspace=packages/knowledge-engine \
 && npm run build --workspace=packages/backend

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

```dockerfile
# deploy/Dockerfile.frontend — Vite → nginx
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
RUN npm ci --workspace=packages/frontend
RUN npm run build --workspace=packages/shared \
 && npm run build --workspace=packages/frontend

FROM nginx:alpine
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

#### GCP本番構成

```
┌──────────────────────────────────────────────────────────┐
│                     GCP Project                          │
│                                                          │
│  ┌─────────────┐     ┌─────────────┐                    │
│  │ Cloud Build  │────→│  Artifact   │                    │
│  │ (CI/CD)      │     │  Registry   │                    │
│  └─────────────┘     └──────┬──────┘                    │
│                              │                           │
│                    ┌─────────▼─────────┐                │
│                    │    Cloud Run       │                │
│                    │  ┌──────────────┐  │                │
│                    │  │   Backend    │  │                │
│                    │  │  (port 3001) │  │                │
│                    │  └──────┬───────┘  │                │
│                    │  ┌──────┼───────┐  │                │
│                    │  │  Frontend    │  │                │
│                    │  │  (nginx:80)  │  │                │
│                    │  └──────────────┘  │                │
│                    └─────────┬─────────┘                │
│                              │                           │
│                    ┌─────────▼─────────┐                │
│                    │   Cloud SQL       │                │
│                    │ PostgreSQL 16     │                │
│                    │ + pgvector拡張    │                │
│                    └───────────────────┘                │
│                                                          │
│  ┌───────────────┐  ┌───────────────┐                   │
│  │ Secret Manager│  │ Cloud Logging │                   │
│  │ (API keys)    │  │ + Monitoring  │                   │
│  └───────────────┘  └───────────────┘                   │
└──────────────────────────────────────────────────────────┘
```

#### Cloud Build パイプライン

```yaml
# deploy/cloudbuild.yaml
steps:
  # 1. Build & push backend image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'deploy/Dockerfile.backend', '-t', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/backend:${COMMIT_SHA}', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/backend:${COMMIT_SHA}']

  # 2. Build & push frontend image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'deploy/Dockerfile.frontend', '-t', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/frontend:${COMMIT_SHA}', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/frontend:${COMMIT_SHA}']

  # 3. Run DB migrations
  - name: 'ghcr.io/amacneil/dbmate'
    args: ['--url', '${_DATABASE_URL}', 'up']

  # 4. Deploy backend to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'deploy', 'vimeo-brain-backend', '--image', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/backend:${COMMIT_SHA}', '--region', '${_REGION}', '--platform', 'managed']

  # 5. Deploy frontend to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args: ['gcloud', 'run', 'deploy', 'vimeo-brain-frontend', '--image', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/${_REPO}/frontend:${COMMIT_SHA}', '--region', '${_REGION}', '--platform', 'managed']

substitutions:
  _REGION: asia-northeast1
  _REPO: vimeo-brain
```

#### GCPセットアップ手順

```bash
# 1. プロジェクト設定
gcloud config set project YOUR_PROJECT_ID

# 2. 必要なAPIを有効化
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com

# 3. Artifact Registry リポジトリ作成
gcloud artifacts repositories create vimeo-brain \
  --repository-format=docker \
  --location=asia-northeast1

# 4. Cloud SQL インスタンス作成（pgvector対応）
gcloud sql instances create vimeo-brain-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-northeast1 \
  --database-flags=cloudsql.enable_pgvector=on

# 5. データベース作成
gcloud sql databases create vimeo_brain --instance=vimeo-brain-db

# 6. シークレット登録
echo -n "your-vimeo-token" | gcloud secrets create VIMEO_ACCESS_TOKEN --data-file=-
echo -n "your-anthropic-key" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
echo -n "your-openai-key" | gcloud secrets create OPENAI_API_KEY --data-file=-

# 7. Cloud Buildトリガー設定（mainブランチpush時）
gcloud builds triggers create github \
  --repo-name=vimeo-brain \
  --branch-pattern="^main$" \
  --build-config=deploy/cloudbuild.yaml
```

### Phase 3 検証

#### ローカル

```bash
# フルスタック起動
docker compose -f deploy/docker-compose.yml up

# チャットテスト
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"動画で話されていた内容について教えて"}'

# フロントエンド
# ブラウザで http://localhost:3000 にアクセス
```

#### GCP

```bash
# Cloud Buildでデプロイ
gcloud builds submit --config=deploy/cloudbuild.yaml

# Cloud Runサービス確認
gcloud run services list --region=asia-northeast1

# ヘルスチェック
curl https://vimeo-brain-backend-xxxxx.a.run.app/health
```

---

## 環境変数

### ローカル開発（`.env`）

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `DATABASE_URL` | PostgreSQL接続文字列 | `postgres://vimeo:vimeo@localhost:5432/vimeo_brain` |
| `VIMEO_ACCESS_TOKEN` | Vimeo APIトークン | — |
| `EMBEDDING_PROVIDER` | embeddingプロバイダー | `openai` |
| `LLM_PROVIDER` | LLMプロバイダー | `anthropic` |
| `OPENAI_API_KEY` | OpenAI APIキー | — |
| `ANTHROPIC_API_KEY` | Anthropic APIキー | — |
| `PORT` | バックエンドポート | `3001` |
| `NODE_ENV` | 環境 | `development` |
| `VIMEO_WEBHOOK_SECRET` | Vimeo Webhook HMAC署名検証キー | — |
| `KNOWLEDGE_DATA_DIR` | Knowledge Engineデータ配置先 | `.vimeo-brain` |

### GCP本番（Secret Manager）

| シークレット名 | マウント先環境変数 |
|---------------|-------------------|
| `VIMEO_ACCESS_TOKEN` | `VIMEO_ACCESS_TOKEN` |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `DATABASE_URL` | Cloud SQL Proxy経由で自動設定 |
| `VIMEO_WEBHOOK_SECRET` | `VIMEO_WEBHOOK_SECRET` |

---

## 重要な設計判断

| # | 判断 | 詳細 |
|---|------|------|
| 1 | LadybugDB不可時の代替 | SQLite + better-sqlite3でグラフテーブルを自前実装 |
| 2 | コミュニティ検出 | graphologyのLouvain/Leidenプラグイン |
| 3 | LLMコスト最適化 | バッチ処理（20セグメント/1回呼出）で概念抽出 |
| 4 | Vimeo APIレート制限 | 429応答時のexponential backoff |
| 5 | 増分更新 | 新Transcriptのみパイプライン実行、Community/Flowは全体再計算（数百動画規模まで数秒で完了見込み） |
| 6 | GCPリージョン | `asia-northeast1`（東京）でレイテンシ最小化 |
| 7 | Cloud Run | コンテナベースのサーバーレス、0スケール対応でコスト最適化 |
| 8 | Cloud SQL | マネージドPostgreSQLでpgvector対応、自動バックアップ |
| 9 | Vimeo Webhook | `video.text_track.complete`イベント購読でリアルタイム取り込み。ポーリングはフォールバック |
| 10 | コミュニティ検出 | graphology-communities-louvain（Louvain）を使用。Leiden実装は未公開のため将来差し替え可能な設計 |
| 11 | Cloud Run永続化 | Cloud Storage FUSEでLadybugDBデータ永続化。性能不足時はPG一元化にフォールバック |

---

## パイプライン耐障害性

各ステージの完了ステータスを `ingest_log` に記録し、失敗時は最終成功ステージから再開可能にする。

```
ingest_log 拡張フィールド:
  - last_completed_stage: INT (1-7)
  - stage_details: JSONB  # 各ステージの処理結果メタデータ
```

| 失敗ステージ | リカバリ方法 |
|-------------|-------------|
| Stage 1 (VTT Parse) | VTT再ダウンロード → Stage 1から再実行 |
| Stage 2 (Segment Build) | Stage 2から再実行 |
| Stage 3 (Concept Extract) | LLMリトライ（exponential backoff、最大3回） |
| Stage 4 (Graph Build) | トランザクションロールバック → Stage 4から再実行 |
| Stage 5 (Community Detect) | Stage 5から再実行（既存ノード/エッジは保持） |
| Stage 6 (Flow Detect) | Stage 6から再実行 |
| Stage 7 (Embedding Gen) | 未生成セグメントのみ再生成 |

---

## テスト戦略

| レイヤー | ツール | 対象 |
|---------|-------|------|
| ユニットテスト | Vitest | VTTパーサー、重複判定、ハッシュ、セグメントビルダー |
| API テスト | Vitest + Supertest | 全エンドポイント、Webhook署名検証 |
| 統合テスト | Vitest + testcontainers | PostgreSQL + Knowledge Engine パイプライン |
| E2E テスト | Playwright | チャットUI、動画管理、取り込みフロー |

**カバレッジ目標**: 80%以上

---

## LLMコスト見積もり

1時間の動画を取り込む場合の概算:

| 項目 | 数値 |
|------|------|
| 動画時間 | 3,600秒 |
| VTTキュー数 | 約600-900キュー |
| セグメント数（2秒ギャップ結合後） | 約300-500セグメント |
| LLMバッチ数（20セグメント/バッチ） | 15-25回 |
| 概算入力トークン/バッチ | 約2,000トークン |
| 概算出力トークン/バッチ | 約500トークン |
| Claude Sonnet 4コスト/バッチ | 約$0.01 |
| **1動画あたり合計** | **約$0.15-$0.25** |
| **月間100動画** | **約$15-$25** |

---

## 依存関係グラフ（タスク間）

```
Phase 1.1（ルート設定）
  ├──→ Phase 1.2（共有型）
  ├──→ Phase 1.3（DB）
  └──→ Phase 1.4（Backend骨格）← Phase 1.2
           ├──→ Phase 2.2（Vimeo + 取り込み）← Phase 2.1
           └──→ Phase 3.1（Chat API）← Phase 2.1

Phase 2.1（Knowledge Engine）← Phase 1.2

Phase 3.3（Frontend）← Phase 1.2
Phase 3.2（MCP Server）← Phase 2.1
Phase 3.4（Docker + GCP）← Phase 1.3, 1.4
```

---

## ステータス

| Phase | 状態 | 完了日 |
|-------|------|--------|
| Phase 1.1 ルート設定 | pending | — |
| Phase 1.2 共有型 | pending | — |
| Phase 1.3 DB | pending | — |
| Phase 1.4 Backend骨格 | pending | — |
| Phase 2.1 Knowledge Engine | pending | — |
| Phase 2.2 Vimeo取り込み | pending | — |
| Phase 3.1 Chat API | pending | — |
| Phase 3.2 MCP Server | pending | — |
| Phase 3.3 Frontend | pending | — |
| Phase 3.4 Docker + GCP | pending | — |
