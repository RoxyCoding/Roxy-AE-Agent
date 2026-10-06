# Development

対象: **AE 2024〜2026 → CEP 版**(`apps/ae-cep-plugin`)、**AE 27 以降 → UXP 版**(`apps/ae-plugin`)。MCP Server・コマンド定義・ツールは共通。

## セットアップ

```bash
npm install
npm run build          # MCP Server + UXP Plugin
npm run typecheck      # tsc --noEmit(全パッケージ)
npm test               # vitest(unit + 統合 + MCP stdio E2E)
```

- monorepo: npm workspaces(`packages/*`, `apps/*`)。各パッケージは TS ソースを直接 export し、実行物は esbuild で bundle
- MCP Server: `apps/mcp-server/build.mjs` → `dist/index.js`, `dist/diag.js`, `dist/smoke.js`(依存込み単一ファイル)
- Plugin: `apps/ae-plugin/build.mjs` → `dist/`(static をコピー + `main.js`)。`npm run watch -w @roxy/ae-plugin` で監視ビルド
- `.ccx` パッケージ: `npm run package:plugin` → `apps/ae-plugin/release/<id>_<version>.ccx`(`package.mjs`、ビルド後に dist を ZIP 化)
- パネル UI と WebSocket 接続は `packages/plugin-panel`(`PanelExecutor` インターフェース)、AE 操作は `apps/ae-plugin/src`

## テスト構成

| ファイル | 内容 |
| --- | --- |
| `tests/units.test.ts` | protocol(Metadata codec, lock, $ref, selector)、PNG 解析、Validator ルール、MV plan |
| `tests/integration.test.ts` | **実際の** WsBridge ⇄ WebSocket ⇄ パネル Connection を、**UXP 版(Dispatcher + TS ハンドラ)と CEP 版(CepExecutor + ExtendScript を ES5 機能を除いた vm で実行)の両方**で実行。AE ホストだけ `tests/fakes/fake-ae.ts` に差し替え、Phase 1 シナリオ・曖昧Selector・lock・削除スナップショット・batch・タイムアウト/切断を検証 |
| `tests/cep-host.test.ts` | CEP 版の `jsx/*.jsx` を acorn で **ES3 として構文解析**、ES5 以降の API 使用を検出、JSON/Metadata 互換性 |
| `tests/phase2.test.ts` | Phase 2(素材読み込み、レイヤー作成/属性/順序、シェイプ・マスク・テキストアニメーター、Ease、Render、Checkpoint、missing-effects)を UXP/CEP 両方で検証 |
| `tests/phase4.test.ts` | PNG デコード/解析/差分、ffprobe 結果の判定、修正案生成(単体)+ レビューループ・承認つき自動修正を UXP/CEP 両方で |
| `tests/mcp-stdio.test.ts` | ビルド済み `dist/index.js` を起動し MCP JSON-RPC(initialize / tools/list / tools/call)を検証。未ビルドならスキップ |

> Fake AE は公式ドキュメントのオブジェクトモデルを模したテストダブルです。**実機の After Effects での動作保証ではありません。**

## 実機での確認手順(Phase 1)

1. `npm run build`
2. AE 27.0+ を起動、UXP Developer Tool で `apps/ae-plugin/dist/manifest.json` を Add → Load
3. MCP クライアントを止めた状態で `npm run diag` → `connected` と ping を確認
4. `npm run smoke` → 全ステップ `OK` を確認
5. AE で `ROXY_PHASE1_<日時>` Comp を開き、以下を目視確認
   - 中央に「ROXY」、0→1秒でフェードイン、1→3秒で拡大、4→5秒でフェードアウト
   - Glow が適用されている
   - Edit > Undo で各操作が1ステップずつ戻る
6. smoke が出力した `imagePath` の PNG を開き、2.5秒時点の絵であることを確認
7. MCP クライアントを登録し、AI に README の「最小サンプル」を指示

問題があれば Plugin パネルの debug log と、`ROXY_LOG_LEVEL=debug ROXY_LOG_FILE=...` を付けた Server ログを確認してください。Operation ID(`op_...`)で両方を突き合わせられます。

## CEP 版(AE 2024〜2026)

```
apps/ae-cep-plugin/
  static/CSXS/manifest.xml   Host AEFT [24.0,26.9] / CSXS 11.0 / ScriptPath ./jsx/host.jsx
  static/index.html, .debug  パネル UI、DevTools ポート 8099
  src/main.ts                bootPanel + CepExecutor(window.__adobe_cep__.evalScript)
  src/cep-executor.ts        zod 検証・既定値適用 → RoxyHost.dispatch(JSON) → 結果 JSON
  jsx/00-core … 99-host.jsx  ExtendScript (ES3) 実装。ビルドで名前順に連結し dist/jsx/host.jsx に
  scripts/install.ps1        PlayerDebugMode 設定 + 拡張フォルダへのジャンクション
```

- AE 2024 = CEP 11、AE 2025/2026 = CEP 12。署名なし拡張には `HKCUSoftwareAdobeCSXS.<11|12>PlayerDebugMode = "1"`
- **ExtendScript は ES3**: JSON・`Array#map/forEach/filter/indexOf`・`Object.keys`・`String#trim`・`Date.now` が無い。`jsx/00-core.jsx` の `ROXY.map/filter/keys/stringify/parse/now` を使う(`cep-host.test.ts` が検出)
- コマンドを変更する場合は **UXP 版(`apps/ae-plugin/src/commands`)と CEP 版(`apps/ae-cep-plugin/jsx`)の両方**を更新し、`integration.test.ts`(両方で実行)で確認
- Preview: `saveFrameToPng` は ExtendScript 非公開のため `typeof` で確認して使用、無ければ Render Queue で1フレーム書き出し(他のキュー項目は一時停止して復元)

## UXP 版 manifest

`apps/ae-plugin/static/manifest.json`:

- `static/manifest.json` は **AE (Beta) 同梱の Adobe 製 UXP プラグイン**(`Support Files\UXP\plugins\com.adobe.dva.ae.*`、Adobe 自身の `com.adobe.dva.ae.mcp` を含む)と同じ形式: `host: [{ app: "aftereffects", minVersion: "27.0", dependencies: { dvascripting: "", dvauxpui: "" } }]`、`requiredPermissions.network.domains: ["ws://localhost:*", "ws://127.0.0.1:*"]`
  - AE UXP の公式ドキュメントには manifest の記載が無く、UXP 共通ドキュメントの `host.app` 一覧にも AE は無い。上記は同梱プラグインで確認した値
- サイドロード(`scripts/sideload.ps1`): `<AE>\Support Files\UXP\plugins\com.roxy.aeagent` → `dist` のジャンクション。AE 起動時に読み込まれる(非公式)
- `.ccx`(`package.mjs`): パッケージ時に `host` を単一オブジェクト(dependencies なし)へ変換。配列のままだと UPIA が `-4`
- インストールのエラーコード: `-631` = Creative Cloud 未サインイン、`-4` = manifest 解析失敗、`-411` = 対応アプリが見つからない(AE 27 Beta で発生)

## AE UXP API 調査メモ(2026-10 時点)

公式: https://developer.adobe.com/after-effects/uxp/after-effects-api/ (Early Preview, 全メンバー Min Version 27.0)

| 用途 | 使用 API | 備考 |
| --- | --- | --- |
| ホスト | `require("aftereffects")` → Application | 同期 API(Project の全メソッドは同期と明記) |
| Undo | `app.beginUndoGroup(name)` / `endUndoGroup()` | |
| Effect 一覧 | `app.effects` → `{displayName, matchName, category, version}[]` | サードパーティ含む |
| Comp 作成 | `project.items.addComp(name,w,h,pa,dur,fps)` | |
| Comp 列挙 | `project.numItems`, `project.item(i)`(1始まり), `itemByID` | `typeName` はローカライズされるので型判定は duck typing |
| Text | `comp.layers.addText(text)`、Source Text `TextDocument`(`text, font, fontSize, fillColor, justification`) | |
| 範囲 | `TextLayer.sourceRectAtTime(t, extents)` | アンカー中央化に使用 |
| プロパティ | `property(indexOrName)`(matchName/表示名/index), `addProperty`, `canAddProperty`, `setValue`, `setValueAtTime`, `valueAtTime`, `nearestKeyIndex`, `keyTime`, `keyValue`, `removeKey`, `setInterpolationTypeAtKey`, `expression`, `expressionError` | |
| Layer | `id`(永続), `comment`(RW), `duplicate()`, `remove()`, `matchName`(`ADBE Text Layer` 等) | |
| Preview | `CompItem.saveFrameToPng(seconds, path)` / `saveDraftFrameToPng` → `DeferredCall` | DeferredCall の待ち方は未記載(`.wait()` への言及のみ)。サーバ側で PNG 完成をポーリング |
| 変化検知 | `CompItem/Layer.getRenderGUID(...)` → `DeferredCall` | Phase 2 で Preview の再生成判定に使う予定 |
| 素材欠落 | `FootageItem.footageMissing` | |
| Metadata | `comment`(採用) / `project.xmpPacket`(候補) | |

未確認 / 制限:
- enum(`KeyframeInterpolationType`, `ParagraphJustification` 等)が UXP でどう公開されるか未記載 → `ae/host.ts#getEnum` がホストモジュールとグローバルを探索。無ければ warning を返して該当手順をスキップ(数値はハードコードしない)
- `KeyframeEase` のコンストラクタが未記載 → Ease 設定は未実装

## plan ツール(サーバ側で合成するツール)

シェイプ・マスク・テキストアニメーター・MV ツールは `@roxy/ae-tools` の `definePlanTool` で定義し、汎用コマンドの組み合わせ(`$ref` で前ステップの結果を参照)を1回の `batch.execute` で実行します。AE 側に専用コードが要らないため、UXP 版と CEP 版で二重実装になりません。`plan` は純関数なので単体テストできます。新しい複合機能はまずこの方式で作れないか検討してください。

## コマンドの追加手順

1. `packages/ae-protocol/src/commands/<area>.ts` に `defineCommand({...})` を追加(`mutates` / `destructive` / `timeoutMs` / `batchable` / `internal`)
2. `apps/ae-plugin/src/commands/<area>.ts` にハンドラを追加し、`commands/index.ts` の HANDLERS に含める
3. MCP ツールは自動生成されます(`internal: true` ならされない)
4. Fake AE に必要なメンバーを追加し、`tests/integration.test.ts` にケースを追加
5. `docs/COMMANDS.md` を更新

## ログの見方

```
2026-10-06T08:00:00.000Z [ROXY][MCP] -> comp.create {"id":"op_mg2k3x_1"}
2026-10-06T08:00:00.020Z [ROXY][AE] <- comp.create ok (20ms) {"id":"op_mg2k3x_1"}
2026-10-06T08:00:01.000Z [ROXY][AE][ERROR] ...
```
