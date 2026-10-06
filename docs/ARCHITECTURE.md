# Architecture

## 全体像

```
┌──────────────────────┐  stdio (MCP JSON-RPC)   ┌──────────────────────────────────────────┐
│ Claude Code / Codex  │ ──────────────────────▶ │ apps/mcp-server                           │
└──────────────────────┘                         │  ├ mcp/register.ts   ToolDefinition→MCP    │
                                                 │  ├ bridge/ws-bridge  WebSocket Server       │
                                                 │  │   接続状態 / opId / Timeout / ログ       │
                                                 │  └ runtime.ts        ToolContext            │
                                                 │ packages/ae-tools     Low-Level Tools        │
                                                 │ packages/mv-tools     High-Level MV Tools    │
                                                 │ packages/preview-engine  PNG待機・検証       │
                                                 │ packages/project-validator  診断ルール       │
                                                 └───────────────┬──────────────────────────┘
                                                                 │ ws://127.0.0.1:47820  (subprotocol roxy-ae.v1)
                                                 ┌───────────────▼──────────────────────────┐
                                                 │ apps/ae-plugin (UXP, AE 27+)              │
                                                 │  or apps/ae-cep-plugin (CEP+ExtendScript, │
                                                 │     AE 2024-2026) — 同じコマンドを実装      │
                                                 │  ├ plugin-panel    WS client / 再接続 / UI │
                                                 │  ├ dispatcher.ts   検証→Undo→実行→構造化   │
                                                 │  ├ commands/*      コマンドハンドラ         │
                                                 │  └ ae/*            AE UXP API アクセス層    │
                                                 └───────────────┬──────────────────────────┘
                                                                 │ require("aftereffects")
                                                          After Effects 27.0+
```

**責務分離**: 意思決定(何を作るか、どう直すか)は MCP/AI 側。Plugin は「渡されたコマンドを確実に実行し、結果か構造化エラーを返す」だけです。

## パッケージ

| パッケージ | 役割 | 依存 |
| --- | --- | --- |
| `packages/shared` | タグ付き Logger(`[ROXY][MCP]` 等)、Operation ID | なし |
| `packages/ae-protocol` | **唯一の真実**: Envelope、ErrorCode、Selector、Roxy Metadata codec、コマンドスキーマ(zod)、batch `$ref` | zod |
| `packages/ae-tools` | コマンドカタログ → MCP ツール自動生成 + Preview/Batch/Validate/Status のカスタムツール | protocol, preview-engine, validator |
| `packages/mv-tools` | High-Level Tool。引数 → Low-Level コマンド列(plan)にコンパイルし `batch.execute` 1回で実行 | ae-tools |
| `packages/preview-engine` | Preview 出力パス決定、PNG 書き込み完了待ち、IHDR から寸法取得、古い Preview の整理 | shared |
| `packages/project-validator` | `project.collectDiagnostics` のスナップショットに対するルール群 | protocol |
| `apps/mcp-server` | stdio MCP Server、WebSocket Bridge、CLI(diag/smoke) | 上記すべて |
| `packages/plugin-panel` | パネル UI + WebSocket 接続、`PanelExecutor` インターフェース | protocol, shared |
| `apps/ae-plugin` | UXP 版(AE 27+)。TS ハンドラが UXP API を直接呼ぶ(esbuild で `dist/main.js` に bundle) | protocol, shared, plugin-panel |
| `apps/ae-cep-plugin` | CEP 版(AE 2024〜2026、UXP 公開までのつなぎ)。パネルで zod 検証 → `evalScript` → ES3 の `jsx/host.jsx` が AE を操作 | protocol, shared, plugin-panel |

コマンドの zod スキーマは **MCP の inputSchema と Plugin 側の引数検証の両方**で使われるため、ズレが起きません。

## 通信プロトコル

すべてのコマンドが同じ Request / Response 形式です。

```jsonc
// Server → Plugin
{ "type": "request", "id": "op_mg2k3x_1a", "command": "comp.create",
  "args": { "name": "TEST", "width": 1920, "height": 1080, "duration": 5, "fps": 60 },
  "meta": { "timeoutMs": 30000, "source": "comp.create" } }

// Plugin → Server
{ "type": "response", "id": "op_mg2k3x_1a", "success": true,
  "data": { "compId": 123, "comp": { ... } },
  "warnings": [], "meta": { "durationMs": 12 } }

// 失敗
{ "type": "response", "id": "...", "success": false,
  "error": { "code": "AMBIGUOUS_SELECTOR", "message": "...", "details": { "candidates": [...] }, "hint": "..." } }
```

ハンドシェイク: Plugin が接続後 `hello`(protocolVersion, plugin/host 情報, 実行可能コマンド一覧, token)を送り、Server が `hello_ack` を返します。プロトコル不一致・Token 不一致は拒否。
Plugin は 10 秒ごとに `ping`、警告/エラーは `log` メッセージで Server ログへ転送されます(`[ROXY][AE]`)。

`id` は Operation ID として MCP ツール結果(`opId`)・Server ログ・Plugin ログすべてに出るため、1操作を横断追跡できます。

### エラーコード

| code | 意味 |
| --- | --- |
| `AE_NOT_CONNECTED` | Plugin 未接続(AE未起動・パネル未表示) |
| `BRIDGE_UNAVAILABLE` | ポート使用中などで Bridge が待受できていない(10秒毎に再試行) |
| `CONNECTION_LOST` | 実行中に切断 |
| `TIMEOUT` | 応答なし(AE 側で処理が続いている可能性あり) |
| `INVALID_ARGS` / `INVALID_REQUEST` / `UNKNOWN_COMMAND` | 入力不正 |
| `NOT_FOUND` | 対象なし(`details.available` に候補名) |
| `AMBIGUOUS_SELECTOR` | 候補が複数(`details.candidates`)。**勝手に1つ選びません** |
| `LOCKED_FOR_AI` | Roxy Metadata `lockedForAI: true` |
| `CONFLICT` | 同名 Comp など、後の選択を曖昧にする衝突 |
| `UNSUPPORTED` | このAEビルドにAPIが無い |
| `AE_ERROR` | AE が例外を投げた(メッセージに操作名) |
| `PREVIEW_FAILED` / `INTERNAL` | Preview 失敗 / 内部エラー |

## Selector

```json
{ "comp": { "name": "CHORUS" }, "layer": { "name": "LYRICS_MAIN" } }
```

- Comp: `"名前"` / `123`(id) / `{id, name, roxyId, active}`。省略時はアクティブComp
- Layer: `"名前"` / `123`(id) / `{id, name, index, type, roxyId, role, tag}`
- 指定フィールドは AND。0件 → `NOT_FOUND`、2件以上 → `AMBIGUOUS_SELECTOR`
- AE の `id` はセッションを跨いで永続(公式ドキュメント記載)なので最も確実

## Roxy Metadata

```json
{ "roxyId": "lyrics_main_001", "role": "lyrics", "scene": "chorus_01", "managedBy": "roxy", "lockedForAI": false, "tags": [] }
```

**保存先: `CompItem.comment` / `Layer.comment`**(UXP API で RW と明記、.aep に保存される)。
ユーザーのコメントを壊さないよう専用の1行に格納します:

```
ユーザーが書いたコメント
#roxy:{"roxyId":"lyrics_main_001","role":"lyrics"}
```

検討した選択肢:

| 方式 | 採否 | 理由 |
| --- | --- | --- |
| `comment` 専用行 | **採用** | 要素ごと・永続・Layer複製/コピーに追随・パース容易 |
| `Project.xmpPacket` | 将来候補 | 不可視で安全だが RDF/XML を書き換える必要があり、要素 ID との対応表管理が必要 |
| Layer 名への埋め込み | 不採用 | ユーザーの命名と衝突 |

- Roxy が作成した Comp/Text には `managedBy: "roxy"` が自動付与されます
- `layer.duplicate` は複製側の `roxyId` を消去(重複防止)。手動複製による重複は Validator の `duplicate-roxy-id` で検出
- **lockedForAI**: 変更系コマンドは対象(と所属Comp)が lock なら `LOCKED_FOR_AI`。AI は lock を**かけられるが外せない**(ユーザーが AE 上でコメントを編集して解除)
- 保存方式は `ae-protocol/metadata.ts`(codec)と `ae-plugin/src/ae/metadata.ts`(読み書き)に閉じているので差し替え可能

## Undo / Safety

- 変更系コマンド(`mutates: true`)は自動で個別の Undo グループに包まれます(`Roxy: comp.create` など)
- `undo.beginGroup` / `undo.endGroup` で明示グループを開くと、その間のコマンドは1つの Undo ステップになります。接続が切れたら自動で閉じます
- `batch.execute` 全体で1つの Undo グループ
- 削除系(`layer.delete`, `keyframe.remove`)は削除前のスナップショットを Response に含め、`dryRun` をサポート
- Plugin はリクエストを直列実行(AE はシングルスレッド。Undo グループの交錯を防止)
- MCP ツールのハンドラ例外はすべて構造化エラーに変換され、Server は落ちません

## Batch

```json
{ "commands": [
    { "id": "c", "command": "comp.create", "args": { "name": "A", "width": 1920, "height": 1080, "duration": 5, "fps": 60 } },
    { "id": "t", "command": "text.create", "args": { "comp": { "$ref": "c.compId" }, "text": "ROXY" } }
  ],
  "onError": "stop", "undoGroup": "Roxy batch" }
```

- `onError: "stop"`(既定)は最初の失敗で停止。`"continue"` は残りも実行
- **自動ロールバックはしません**(`rolledBack: false`)。結果の `results[]` に各ステップの成否、`stoppedAt` に停止位置
- `$ref` で前ステップの結果を参照(`<stepId>.<data内のパス>`)
- Server 側で事前検証(`$ref` を含まないステップは引数スキーマまで検証)し、不正なら**何も実行せず**拒否
- Preview / Undo 系は batch 内不可(`batchable: false`)

## Preview Engine

調査結果と選択:

| 方法 | 評価 |
| --- | --- |
| `CompItem.saveFrameToPng(seconds, path)` (UXP, AE 27.0) | **採用**。公式 API、単一フレームを直接PNG化。`saveDraftFrameToPng` でドラフト品質も可 |
| Render Queue + Output Module | 連番/動画向け。単一フレーム確認には重い。Phase 2 以降 |
| aerender | AE 本体と別プロセス。プロジェクト保存が前提。最終Render向け |

フロー: Server(preview-engine)が出力パスを決定 → Plugin が `saveFrameToPng` → `DeferredCall` が thenable なら await → **Server が PNG の完成(サイズ安定 + IEND)をポーリング**して寸法を IHDR から読む → `imagePath / width / height / time / compName` を返却。`returnImage: true` なら画像を MCP image content としても返し、AI が自分で見られます。

## Logging

`[ROXY][MCP]` ツール呼び出し / `[ROXY][WS]` 接続・送受信 / `[ROXY][AE]` Plugin 側実行結果 / `[ROXY][ERROR]`(error レベルは常に付与) / `[ROXY][PREVIEW]`

- MCP Server は **stderr** に出力(stdout は MCP 通信路)。`ROXY_LOG_FILE` でファイルにも
- 既定 `info`。`debug` で送受信ペイロードも出力(大きなデータは切り詰め)
- Plugin はパネル下部と UXP コンソールに出力。パネルの「debug log」で切替

## 拡張ポイント

| 将来機能 | 拡張場所 |
| --- | --- |
| 新コマンド | `ae-protocol/commands/*.ts` にスキーマ追加 → `ae-plugin/src/commands/*.ts` にハンドラ追加(MCPツールは自動生成) |
| High-Level MV Tool | `mv-tools` で `defineMvTool({ plan })`。plan は純関数でテスト可能 |
| 別の実行方式(aerender 等) | `PanelExecutor` を実装する、`preview-engine` の新バックエンド |
| Validator ルール | `project-validator/rules.ts` に `ValidationRule` を追加 |
| Metadata 保存方式 | `ae-protocol/metadata.ts` + `ae-plugin/src/ae/metadata.ts` |
| dryRun 全般 | 削除系で実装済みのパターンを他の変更系へ |
