# Knowledge Engine 検索層刷新 — 設計ドキュメント

> GitNexus stable-ops アーキテクチャを文字起こしドメインに適用

## 1. 背景と目的

### 1.1 現状の問題

現在の検索層（`packages/knowledge-engine/src/search/hybrid-search.ts`）は単純な RRF（Reciprocal Rank Fusion）で BM25 + semantic を合成しているだけで、以下の制約がある:

| 問題 | 詳細 |
|------|------|
| スコアリングが粗い | `1/(60+rank)` の単純RRFのみ、ノード型やクエリ意図を考慮しない |
| 日本語対応が弱い | 生クエリをそのまま `plainto_tsquery('simple', ...)` に渡すだけ |
| グラフ構造を活用しない | BM25/semanticの結果のみ、エッジ関係による展開なし |
| トークン予算がない | `limit: 5` 固定でLLMコンテキスト窓を考慮しない |
| フォールバックがない | 検索ヒットゼロ時に空配列を返すだけ |

### 1.2 目標

GitNexus stable-ops（`lib/context_resolver.py`）の実績あるアーキテクチャを転用し、RAG精度を大幅に向上させる。

| 機能 | 現状 | 目標 |
|------|------|------|
| スコアリング | `1/(60+rank)` の単純RRF | `0.5*BM25 + 0.3*GraphDist + 0.2*TypeWeight` |
| 日本語 | 生クエリを `plainto_tsquery` | 助詞除去 + bigram生成 + 3段階フォールバック |
| グラフ活用 | なし | BM25シードからDFS展開、エッジ重み付き |
| トークン予算 | `limit:5` 固定 | `maxTokens` 指定で貪欲選択 |
| クエリ意図 | なし | factual/overview/who_what で型重み調整 |
| フォールバック | 空配列返却 | 生→前処理→OR分割→最新セグメント |

### 1.3 変更しないもの

- パイプライン全7ステージ（VTT parse〜embedding gen）
- DBスキーマ（`knowledge_nodes`, `knowledge_edges`）— マイグレーション不要
- ノード型定義（`KnowledgeNodeType`）・エッジ型定義（`KnowledgeEdgeType`）
- 既存MCPツール6個（query, context, search, topics, flows, stats）
- フロントエンド
- バックエンドのvideo/ingest関連コード

---

## 2. アーキテクチャ概要

### 2.1 全体フロー

```
ユーザークエリ
    │
    ▼
┌──────────────────────────┐
│  1. preprocessQuery()    │  ← 日本語前処理（助詞除去、bigram生成）
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  2. classifyIntent()     │  ← クエリ意図分類（factual/overview/who_what）
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  3. ftsWithFallback()    │  ← 3段階フォールバック付きFTS
│     Level 0: plainto     │
│     Level 1: bigram AND  │
│     Level 2: token OR    │
│     Level 3: recent segs │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  4. semanticSearch()     │  ← embedFn があれば実行（オプショナル）
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  5. expandFromSeeds()    │  ← DFSグラフ展開（エッジ重み付き減衰）
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  6. computeHybridScores()│  ← 重み付きスコア融合
│     0.5*BM25 + 0.3*Graph │
│     + 0.2*TypeWeight     │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  7. applyTokenBudget()   │  ← トークン予算内で貪欲選択
└──────────┬───────────────┘
           │
           ▼
     ResolvedContext
```

### 2.2 ファイル依存グラフ

```
japanese-preprocessor.ts ← 依存なし（純粋関数）
token-budget.ts          ← 依存なし（純粋関数）
        ↓
context-resolver.ts      ← preprocessor, budget, GraphStore, schema/nodes, EmbedFn
        ↓
   ┌────┴─────┐
   ↓          ↓
resolve.ts  chat.service.ts
(MCP tool)  (backend)
   ↓
mcp-server.ts
```

### 2.3 新規・修正ファイル一覧

| ファイル | 区分 | 説明 |
|---------|------|------|
| `knowledge-engine/src/search/japanese-preprocessor.ts` | **新規** | 日本語前処理モジュール |
| `knowledge-engine/src/search/token-budget.ts` | **新規** | トークン予算管理モジュール |
| `knowledge-engine/src/search/context-resolver.ts` | **新規** | 中核の文脈解決エンジン |
| `knowledge-engine/src/db/connection.ts` | **修正** | GraphStoreに4メソッド追加 |
| `knowledge-engine/src/mcp/tools/resolve.ts` | **新規** | MCPツール `knowledge_resolve` |
| `knowledge-engine/src/mcp/mcp-server.ts` | **修正** | 新ツール登録 |
| `knowledge-engine/src/index.ts` | **修正** | 新モジュール re-export |
| `backend/src/services/chat.service.ts` | **修正** | resolveContext統合 |

---

## 3. モジュール詳細設計

### 3.1 日本語前処理モジュール

**ファイル**: `packages/knowledge-engine/src/search/japanese-preprocessor.ts`

**GitNexus対応箇所**: `lib/context_resolver.py:85-124`

#### 型定義

```typescript
export interface PreprocessedQuery {
  original: string;         // 元のクエリ文字列
  cleaned: string;          // 助詞除去後
  bigrams: string[];        // CJK文字のbigram配列
  tokens: string[];         // 空白分割トークン（助詞除去後）
  tsqueryRaw: string;       // plainto_tsquery用（cleaned そのまま）
  tsqueryBigram: string;    // to_tsquery用（bigram1 & bigram2 & ...）
  tsqueryOr: string;        // to_tsquery用（token1 | token2 | ...）
  isCJK: boolean;           // CJKテキストかどうか
}
```

#### 関数

| 関数 | 入力 | 出力 | 説明 |
|------|------|------|------|
| `isCJKText(text)` | `string` | `boolean` | CJK文字（U+3000-U+9FFF, U+F900-U+FAFF）が全文字の30%以上か判定 |
| `removeParticles(text)` | `string` | `string` | 日本語助詞（を,は,が,の,で,に,へ,と,も,か）を除去 |
| `generateBigrams(text)` | `string` | `string[]` | CJK文字列を2文字ずつスライド: `"動画内容"` → `["動画","画内","内容"]` |
| `preprocessQuery(query)` | `string` | `PreprocessedQuery` | 上記を統合したメイン関数 |

#### ロジック詳細

**`preprocessQuery()` の処理フロー**:

```
1. original = query.trim()
2. isCJK = isCJKText(original)
3. cleaned = isCJK ? removeParticles(original) : original
4. bigrams = isCJK ? generateBigrams(cleaned) : []
5. tokens = cleaned.split(/\s+/).filter(t => t.length > 0)
6. tsqueryRaw = cleaned（plainto_tsquery に渡す用）
7. tsqueryBigram = bigrams を ' & ' で結合
   → 例: "動画 & 画内 & 内容"
8. tsqueryOr = tokens を ' | ' で結合
   → 例: "動画内容 | 何 | 話している"
9. return PreprocessedQuery
```

**助詞リスト**（正規表現パターン）:

```
/[をはがのでにへともか]/g
```

> 注: 形態素解析ライブラリ（kuromoji等）は使用しない。GitNexus同様、正規表現ベースの軽量前処理で十分な精度を得る。

### 3.2 トークン予算モジュール

**ファイル**: `packages/knowledge-engine/src/search/token-budget.ts`

**GitNexus対応箇所**: `lib/context_resolver.py:449-457`

#### 型定義

```typescript
export interface BudgetResult<T> {
  selected: T[];            // 予算内に収まった項目
  totalTokens: number;      // 使用トークン数合計
  prunedCount: number;      // 除外された項目数
}
```

#### 関数

| 関数 | 入力 | 出力 | 説明 |
|------|------|------|------|
| `estimateTokens(text)` | `string` | `number` | CJK: `~0.7 tok/char`、Latin: `~0.25 tok/word` でトークン数推定 |
| `selectWithinBudget(items, getText, maxTokens)` | `T[], (T)=>string, number` | `BudgetResult<T>` | スコア順の配列をトークン予算内で貪欲選択 |

#### ロジック詳細

**`estimateTokens()` の推定ロジック**:

```typescript
function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    if (isCJKChar(char)) {
      tokens += 0.7;  // CJK文字は概ね0.7トークン/文字
    } else if (/\s/.test(char)) {
      // 空白はスキップ（単語境界として扱う）
    } else {
      tokens += 0.25; // Latin文字は概ね0.25トークン/文字
    }
  }
  return Math.ceil(tokens);
}
```

**`selectWithinBudget()` のアルゴリズム**:

```
入力: items（スコア降順）, getText（テキスト取得関数）, maxTokens（予算上限）
出力: BudgetResult

1. selected = []
2. totalTokens = 0
3. for each item in items:
     tokens = estimateTokens(getText(item))
     if totalTokens + tokens <= maxTokens:
       selected.push(item)
       totalTokens += tokens
     else:
       break  // 予算超過、以降は全て除外
4. prunedCount = items.length - selected.length
5. return { selected, totalTokens, prunedCount }
```

### 3.3 GraphStore 追加メソッド

**ファイル**: `packages/knowledge-engine/src/db/connection.ts`

#### 追加メソッド一覧

| メソッド | シグネチャ | 用途 |
|---------|----------|------|
| `rawTsSearch` | `(tsquery: string, limit?: number) => Promise<(KnowledgeNode & { rank: number })[]>` | bigram/ORクエリ用（`to_tsquery` 直接使用） |
| `findEdgesBidirectional` | `(nodeId: string, types?: KnowledgeEdgeType[]) => Promise<KnowledgeEdge[]>` | DFS展開用（source + target の UNION で1クエリ） |
| `findNodesByIds` | `(ids: string[]) => Promise<KnowledgeNode[]>` | バッチルックアップ（`WHERE id = ANY($1)`） |
| `getRecentSegments` | `(limit?: number) => Promise<KnowledgeNode[]>` | P0フォールバック用（最新Segment返却） |

#### SQL詳細

**`rawTsSearch`**:
```sql
SELECT *, ts_rank(
  to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, '')),
  to_tsquery('simple', $1)
) AS rank
FROM knowledge_nodes
WHERE to_tsvector('simple', COALESCE(text_content, '') || ' ' || COALESCE(name, ''))
  @@ to_tsquery('simple', $1)
ORDER BY rank DESC
LIMIT $2
```

**`findEdgesBidirectional`**:
```sql
SELECT * FROM knowledge_edges
WHERE (source_id = $1 OR target_id = $1)
  AND ($2::text[] IS NULL OR type = ANY($2))
```

**`findNodesByIds`**:
```sql
SELECT * FROM knowledge_nodes WHERE id = ANY($1)
```

**`getRecentSegments`**:
```sql
SELECT * FROM knowledge_nodes
WHERE type = 'Segment'
ORDER BY created_at DESC
LIMIT $1
```

### 3.4 Context Resolver（中核モジュール）

**ファイル**: `packages/knowledge-engine/src/search/context-resolver.ts`

**GitNexus対応箇所**: `lib/context_resolver.py` の `assemble_context()`

#### 型定義

```typescript
/** クエリ意図 */
export type QueryIntent = 'factual' | 'overview' | 'who_what';

/** 解決オプション */
export interface ResolveOptions {
  maxTokens?: number;    // デフォルト: 4000
  maxDepth?: number;     // DFS最大深度、デフォルト: 3
  intent?: QueryIntent;  // 明示指定、未指定時は自動分類
}

/** スコア付きノード */
export interface ScoredNode {
  node: KnowledgeNode;
  score: number;
  source: 'bm25' | 'semantic' | 'graph';
  depth: number;         // DFS深度（BM25/semanticは0）
}

/** 解決結果 */
export interface ResolvedContext {
  nodes: ScoredNode[];           // スコア降順
  intent: QueryIntent;           // 判定された意図
  totalTokens: number;           // 使用トークン数
  prunedCount: number;           // トークン予算で除外されたノード数
  fallbackLevel: number;         // FTSフォールバックレベル（0-3）
  query: PreprocessedQuery;      // 前処理結果
}
```

#### メインAPI

```typescript
export async function resolveContext(
  store: GraphStore,
  query: string,
  embedFn: EmbedFn | null,     // null = semantic検索スキップ
  options?: ResolveOptions
): Promise<ResolvedContext>
```

#### 内部フロー

```
resolveContext(store, query, embedFn, options)
│
├── 1. preprocessQuery(query)
│   → PreprocessedQuery { cleaned, bigrams, tokens, tsquery* }
│
├── 2. classifyIntent(query)
│   → QueryIntent ('factual' | 'overview' | 'who_what')
│
├── 3. ftsWithFallback(store, preprocessed)
│   ├── Level 0: store.fullTextSearch(cleaned, 20)
│   ├── Level 1: store.rawTsSearch(tsqueryBigram, 20)
│   ├── Level 2: store.rawTsSearch(tsqueryOr, 20)
│   └── Level 3: store.getRecentSegments(20)
│   → { seeds: ScoredNode[], fallbackLevel: number }
│
├── 4. [Optional] semanticSearch
│   └── embedFn ? store.semanticSearch(embedding, 20) : []
│   → semanticNodes: ScoredNode[]
│
├── 5. expandFromSeeds(store, seeds, maxDepth, intent)
│   └── DFS with edge weight decay
│   → graphNodes: ScoredNode[]
│
├── 6. computeHybridScores(ftsNodes, graphNodes, semanticNodes, intent)
│   └── 0.5*BM25 + 0.3*graphScore + 0.2*typeWeight
│   → merged: ScoredNode[] (score desc)
│
├── 7. applyTokenBudget(merged, maxTokens)
│   → { selected, totalTokens, prunedCount }
│
└── return ResolvedContext
```

#### 3.4.1 意図分類（`classifyIntent`）

**ルールベース**（LLM呼び出し不要）:

```typescript
function classifyIntent(query: string): QueryIntent {
  const q = query.toLowerCase();

  // who_what: 人物・概念への質問
  if (/誰|何|who|what|どういう|どんな/.test(q)) return 'who_what';

  // overview: 全体像・まとめへの質問
  if (/まとめ|概要|全体|要約|overview|summary|について/.test(q)) return 'overview';

  // factual: デフォルト（具体的な事実への質問）
  return 'factual';
}
```

#### 3.4.2 FTS 3段階フォールバック

```
Level 0: plainto_tsquery('simple', cleaned)
  → store.fullTextSearch(cleaned, 20)
  → ヒット > 0 なら return

Level 1: to_tsquery('simple', bigram1 & bigram2 & ...)
  → store.rawTsSearch(tsqueryBigram, 20)
  → ヒット > 0 なら return

Level 2: to_tsquery('simple', token1 | token2 | ...)
  → store.rawTsSearch(tsqueryOr, 20)
  → ヒット > 0 なら return

Level 3: getRecentSegments(20)
  → 必ず何か返す（最新セグメント）
```

#### 3.4.3 DFS グラフ展開（`expandFromSeeds`）

**アルゴリズム**:

```
入力: seeds（BM25/semantic シードノード群）, maxDepth, intent
出力: graphNodes（DFSで到達したノード群、スコア付き）

EDGE_WEIGHTS = {
  CONTAINS: 0.9,
  MENTIONS: 0.8,
  FOLLOWS:  0.7,
  PART_OF_TOPIC: 0.7,
  RELATES_TO: 0.6,
  STEP_IN_FLOW: 0.5,
  CROSS_REFS: 0.4,
  MEMBER_OF: 0.3,
}

1. visited = new Set<string>()
2. queue = seeds.map(s => ({ nodeId: s.node.id, score: s.score, depth: 0 }))
3. results: ScoredNode[] = []
4. for each item in queue (BFS/DFS hybrid):
     if visited.has(item.nodeId) → skip
     visited.add(item.nodeId)
     if item.depth > 0:  // depth 0 はシードノード自体
       results.push({ node, score: item.score, source: 'graph', depth: item.depth })
     if item.depth < maxDepth:
       edges = store.findEdgesBidirectional(item.nodeId)
       for each edge:
         neighborId = (edge.source_id === item.nodeId) ? edge.target_id : edge.source_id
         if visited.has(neighborId) → skip
         edgeWeight = EDGE_WEIGHTS[edge.type] || 0.3
         neighborScore = item.score * edgeWeight / (item.depth + 1)
         if neighborScore < 0.01 → skip (pruning)
         queue.push({ nodeId: neighborId, score: neighborScore, depth: item.depth + 1 })
5. return results
```

**ポイント**:
- `visited` セットでサイクル防止
- `edgeWeight / (depth + 1)` で距離に応じた減衰
- `0.01` 未満でプルーニング（無限展開防止）
- ノードの実データは `findNodesByIds` でバッチ取得

#### 3.4.4 ハイブリッドスコアリング（`computeHybridScores`）

**スコア計算式**:

```
hybridScore = 0.5 * bm25Norm + 0.3 * graphScore + 0.2 * typeWeight
```

**BM25正規化**:
```
bm25Norm = bm25Rank / maxBm25Rank  // 0.0 ~ 1.0 に正規化
```

**型重み**（GitNexus `TYPE_WEIGHTS` 転用）:

| ノード型 | 基本重み | GitNexus対応ノード |
|---------|---------|-------------------|
| Segment | 1.0 | Skill |
| Video | 0.9 | Agent |
| Topic | 0.7 | KnowledgeDoc |
| Concept | 0.5 | DataSource |
| NarrativeFlow | 0.3 | ExternalService |
| Transcript | 0.2 | — |

**意図別調整**（GitNexus `TASK_TYPE_ADJUSTMENTS` 転用）:

| 意図 | Segment | Topic | Concept | NarrativeFlow |
|------|---------|-------|---------|--------------|
| factual | ×1.2 | ×0.8 | ×1.1 | ×0.5 |
| overview | ×0.8 | ×1.3 | ×0.7 | ×1.2 |
| who_what | ×1.1 | ×0.7 | ×1.3 | ×0.5 |

**最終typeWeight計算**:
```
typeWeight = BASE_TYPE_WEIGHTS[node.type] * INTENT_ADJUSTMENTS[intent][node.type]
```

#### 3.4.5 ノードマージ戦略

同一ノードが複数ソース（BM25, semantic, graph）に出現する場合:

```
mergedScore = max(bm25Score, semanticScore) の source でスコア計算
graphScore はそのまま加算
→ つまり BM25/semantic のうち高い方 + graph のスコアで融合
```

### 3.5 MCP `knowledge_resolve` ツール

**ファイル**: `packages/knowledge-engine/src/mcp/tools/resolve.ts`

#### ツール定義

```typescript
{
  name: 'knowledge_resolve',
  description: 'Advanced context resolution with Japanese preprocessing, graph expansion, and token budget management. Returns the most relevant knowledge nodes for a query.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (Japanese or English)',
      },
      max_tokens: {
        type: 'number',
        description: 'Token budget for results (default: 4000)',
      },
      intent: {
        type: 'string',
        enum: ['factual', 'overview', 'who_what'],
        description: 'Query intent override (auto-detected if omitted)',
      },
    },
    required: ['query'],
  },
}
```

#### Embedding 関数の解決

```typescript
// OPENAI_API_KEY があれば OpenAI embedding を有効化
// なければ FTS + グラフ展開のみで動作（semantic検索スキップ）
const embedFn = process.env.OPENAI_API_KEY
  ? createOpenAIEmbedFn()
  : null;
```

#### 出力フォーマット

```markdown
## Resolve: "動画の内容" (intent: factual)

### Results (8 nodes, 2847 tokens, 3 pruned)
Fallback level: 0 (direct match)

#### [Segment] セグメント名 (score: 0.89)
- Video: 動画タイトル @ 2:30
- Text: テキスト内容...
- Source: bm25, depth: 0

#### [Topic] トピック名 (score: 0.65)
- Keywords: キーワード1, キーワード2
- Source: graph, depth: 1
...
```

### 3.6 ChatService 統合

**ファイル**: `packages/backend/src/services/chat.service.ts`

#### 変更箇所

```diff
- import { GraphStore, hybridSearch, type SearchResult } from '@vimeo-brain/knowledge-engine';
+ import { GraphStore, resolveContext, type ResolvedContext, type ScoredNode } from '@vimeo-brain/knowledge-engine';

  // chat() メソッド内:
- const results = await hybridSearch(
-   this.graphStore,
-   message,
-   (texts) => this.embeddingService.embed(texts),
-   { limit: 5 },
- );
+ const resolved = await resolveContext(
+   this.graphStore,
+   message,
+   (texts) => this.embeddingService.embed(texts),
+   { maxTokens: 4000 },
+ );

- const { contextText, sources } = this.buildContext(results);
- const prompt = this.buildPrompt(message, contextText);
+ const { contextText, sources } = this.buildContext(resolved.nodes);
+ const prompt = this.buildPrompt(message, contextText, resolved.intent);

- logger.debug({ sessionId: sid, resultCount: results.length }, 'RAG search completed');
+ logger.debug({
+   sessionId: sid,
+   resultCount: resolved.nodes.length,
+   intent: resolved.intent,
+   fallbackLevel: resolved.fallbackLevel,
+   totalTokens: resolved.totalTokens,
+   prunedCount: resolved.prunedCount,
+ }, 'Context resolved');
```

#### buildContext 更新

`SearchResult` → `ScoredNode` に入力型を変更。内部ロジック（video_title, start_ms の取得、ChatSource構築）は同一。

#### buildPrompt 更新

意図に応じたプロンプト修飾を追加:

```typescript
private buildPrompt(question: string, context: string, intent: QueryIntent): string {
  const intentHint =
    intent === 'overview' ? 'まとめ・概要を重視して回答してください。'
    : intent === 'who_what' ? '人物や概念の説明を重視して回答してください。'
    : '';  // factual はデフォルト

  return `以下の動画の文字起こしに基づいて、ユーザーの質問に答えてください。
${intentHint}
回答は日本語で、具体的に。情報源の動画タイトルとタイムスタンプを参照してください。

--- 関連する動画の文字起こし ---
${context}
--- ここまで ---

質問: ${question}`;
}
```

### 3.7 公開API更新

**ファイル**: `packages/knowledge-engine/src/index.ts`

#### 追加 export

```typescript
// 既存 export は全て維持

// 新モジュール
export { preprocessQuery, isCJKText, type PreprocessedQuery } from './search/japanese-preprocessor.js';
export { estimateTokens, selectWithinBudget, type BudgetResult } from './search/token-budget.js';
export {
  resolveContext,
  type ResolveOptions,
  type ResolvedContext,
  type ScoredNode,
  type QueryIntent,
} from './search/context-resolver.js';
```

---

## 4. スコアリング定数表

### 4.1 エッジ重み（DFS展開時の減衰）

| エッジ型 | 重み | 根拠 |
|---------|------|------|
| `CONTAINS` | 0.9 | 構造的包含関係（Video→Transcript→Segment） |
| `MENTIONS` | 0.8 | 意味的参照（Segment→Concept） |
| `FOLLOWS` | 0.7 | 時系列隣接（Segment→Segment） |
| `PART_OF_TOPIC` | 0.7 | トピック帰属（Segment→Topic） |
| `RELATES_TO` | 0.6 | 概念間関連（Concept→Concept） |
| `STEP_IN_FLOW` | 0.5 | ナラティブフロー参加 |
| `CROSS_REFS` | 0.4 | 動画間相互参照 |
| `MEMBER_OF` | 0.3 | コミュニティ帰属 |

### 4.2 ノード型基本重み

| ノード型 | 重み | 根拠 |
|---------|------|------|
| `Segment` | 1.0 | RAGの主要コンテンツ |
| `Video` | 0.9 | コンテキスト提供 |
| `Topic` | 0.7 | カテゴリ情報 |
| `Concept` | 0.5 | 抽出された概念 |
| `NarrativeFlow` | 0.3 | 構造メタデータ |
| `Transcript` | 0.2 | 中間ノード |

### 4.3 意図別調整係数

| 意図 \ 型 | Segment | Video | Topic | Concept | NarrativeFlow | Transcript |
|-----------|---------|-------|-------|---------|--------------|-----------|
| factual | 1.2 | 1.0 | 0.8 | 1.1 | 0.5 | 0.3 |
| overview | 0.8 | 1.0 | 1.3 | 0.7 | 1.2 | 0.3 |
| who_what | 1.1 | 1.0 | 0.7 | 1.3 | 0.5 | 0.3 |

---

## 5. 実装順序

依存グラフに沿って下から上へ:

```
Step 1: japanese-preprocessor.ts  ← 依存なし
Step 2: token-budget.ts           ← 依存なし
Step 3: connection.ts（4メソッド追加）
Step 4: context-resolver.ts       ← Step 1,2,3 に依存
Step 5: resolve.ts + mcp-server.ts ← Step 4 に依存
Step 6: chat.service.ts           ← Step 4 に依存
Step 7: index.ts                  ← Step 1,2,4 に依存
```

Step 1 と Step 2 は並列実行可能。
Step 5 と Step 6 は並列実行可能。

---

## 6. 検証計画

### 6.1 ビルド確認

```bash
# TypeScript コンパイル
npm run build --workspace=packages/knowledge-engine
npm run build --workspace=packages/backend

# 型チェック（noEmit）
npx tsc --noEmit -p packages/knowledge-engine
npx tsc --noEmit -p packages/backend
```

### 6.2 機能テスト

```bash
# Docker起動（DB + バックエンド）
docker compose -f deploy/docker-compose.yml up

# チャットAPI経由でRAGテスト
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"この動画では何について話していますか？"}'

# MCPツールテスト
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"knowledge_resolve","arguments":{"query":"動画の内容"}}}' \
  | node packages/knowledge-engine/dist/mcp/mcp-server.js
```

### 6.3 ログ確認

`LOG_LEVEL=debug` で以下を確認:

- 前処理結果（cleaned, bigrams, tokens）
- FTSフォールバックレベル
- DFS展開数
- スコアリング内訳
- トークン予算消費量

---

## 7. リスク評価

| リスク | 影響 | 対策 |
|-------|------|------|
| bigram FTS の性能 | `to_tsquery` の直接使用は GINインデックスが効かない場合がある | Level 0（plainto_tsquery）を最優先、bigram は Level 1 フォールバック |
| DFS展開の爆発 | グラフが密だと展開ノード数が増大 | `maxDepth: 3` + `0.01` 未満プルーニング + `visited` セット |
| トークン推定の精度 | 実際のトークン数と乖離する可能性 | 概算値として十分、クリティカルな精度は不要 |
| 既存API後方互換 | `hybridSearch` を使用しているコードが壊れる | `hybridSearch` は削除せず維持、`resolveContext` を新規追加 |

---

## 8. 今後の拡張候補

- [ ] 形態素解析（kuromoji）による前処理精度向上
- [ ] ユーザーフィードバックによるスコアリング重み学習
- [ ] Streaming RAG（チャンク単位のストリーミング応答）
- [ ] マルチモーダル検索（動画サムネイル + テキスト）
