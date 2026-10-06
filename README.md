# Roxy AE Agent

Claude Code / Codex などの **MCPクライアントから Adobe After Effects を操作する AI 制作基盤**です。
最終目標は「素材と簡単な指示だけで、ボカロMVなどをほぼAIに任せて制作できる」状態。
現在は **Phase 1(基盤)** です。

```
Claude Code / Codex ──stdio(MCP)──▶ MCP Server (Node.js) ──WebSocket──▶ AE UXP Plugin ──▶ After Effects
                                    判断・検証・Preview管理             確実な実行のみ
```

- **MCP Server** (`apps/mcp-server`): ツール登録、WebSocket Bridge、Request/Response管理、Timeout、構造化エラー、ログ、AE接続状態管理
- **AE 側(命令を実行するだけの実行層)**。AE のバージョンで使い分けます。MCP Server・コマンド・AI 側の使い方は共通です
  - **CEP 版** (`apps/ae-cep-plugin`): **AE 2024〜2026** 用(パネル + ExtendScript)。**AE 27 の UXP プラグイン公開(2026年11月予定)までのつなぎ**
  - **UXP 版** (`apps/ae-plugin`): **AE 27 以降**用(UXP API `require("aftereffects").app`)
- **Low-Level Tool** (`packages/ae-tools`) と **High-Level MV Tool** (`packages/mv-tools`) は分離。MV Tool は Low-Level コマンドを組み合わせた batch にコンパイルされます

詳細: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) / [docs/COMMANDS.md](docs/COMMANDS.md) / [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) / [docs/ROADMAP.md](docs/ROADMAP.md)

---

## 動作要件

| 項目 | 要件 |
| --- | --- |
| After Effects | **2024〜2026 → CEP 版** / **27 以降 → UXP 版**(AE の UXP プラグインは 2026-10 時点で一般公開前。Adobe は「2026年11月までにパブリックベータ」と発表) |
| UXP Developer Tool | Plugin の読み込みに使用(Creative Cloud からインストール) |
| Node.js | 20 以上(開発確認は 22.19) |
| OS | Windows で開発。macOS は未確認 |

## インストール

```bash
cd "Roxy AE Agent"
npm install
npm run build        # MCP Server と AE Plugin をビルド
npm test             # ユニット + 統合テスト(AE不要。Fake AE を使用)
```

ビルド成果物:
- `apps/mcp-server/dist/index.js` … MCP Server(依存込みの単一ファイル)
- `apps/ae-cep-plugin/dist/` … CEP 版(`CSXS/manifest.xml`, `index.html`, `main.js`, `jsx/host.jsx`)
- `apps/ae-plugin/dist/` … UXP 版(`manifest.json`, `index.html`, `main.js`)

## AE 2024〜2026 で使う(CEP 版・現在のおすすめ)

1. After Effects を**終了**しておく
2. 次を実行(ビルド → 署名なし拡張の許可 → 拡張フォルダへのリンク作成)
   ```bash
   npm run install:cep
   ```
   - レジストリ `HKEY_CURRENT_USERSoftwareAdobeCSXS.11` / `CSXS.12` に `PlayerDebugMode = "1"`(署名なし拡張を読み込むため)
   - `%APPDATA%AdobeCEPextensionscom.roxy.aeagent.cep` → `apps/ae-cep-plugin/dist` のジャンクション
3. After Effects 2026 を起動し、**ウィンドウ > エクステンション > Roxy AE Agent**
4. MCP Server が起動していれば状態が `connected` になります(自動再接続)

コード変更後は `npm run build:cep` → パネルを開き直す(ExtendScript 側の変更は AE 再起動が確実)。パネルの DevTools: AE 起動中に `http://localhost:8099`。
CEP 版で実機確認が必要な点: Preview の `saveFrameToPng` は ExtendScript では非公開 API のため実行時に確認し、無ければ Render Queue(名前に "PNG" を含む出力モジュールテンプレート)で代替。結果の `method` でどちらを使ったか分かります。

## AE 27 以降で使う(UXP 版)

> **注意**: AE 27 (Beta) では、サードパーティの UXP プラグインはまだ有効化されていません(Adobe の発表では 2026年11月までにパブリックベータ)。そのため現時点では以下のどの方法でも読み込めません(UDT の Load が灰色 / `.ccx` は `-411` / サイドロードしてもメニューに出ない)。公開後に使ってください。


### 方法 A: サイドロード(AE 27 Beta 向け・UDT 不要・毎回の Load 不要)

```bash
npm run sideload:plugin      # ビルド → AE に読み込ませる(管理者権限の確認が出ます)
npm run unsideload:plugin    # 取り外し
```

After Effects は起動時に `<AE>Support FilesUXPplugins` 内のプラグインを読み込みます(Adobe 同梱の UXP プラグインの置き場所)。
このスクリプトはそこに `com.roxy.aeagent` → `apps/ae-plugin/dist` のジャンクション(リンク)を作るだけで、AE の他のファイルには触れません。
完了したら **After Effects (Beta) を再起動**し、Roxy AE Agent パネルを開きます。コード変更後は `npm run build:plugin` → AE 再起動で反映されます。

- **非公式の方法**です(Adobe のドキュメントに記載なし)。AE のアップデートでリンクが消えた場合は再実行してください
- 既定の AE の場所は `C:Program FilesAdobeAdobe After Effects (Beta)`。異なる場合は `apps/ae-plugin/scripts/sideload.ps1 -AeDir "<AEのフォルダ>"`
- manifest は AE 同梱プラグインと同じ形式(`host` に `"app": "aftereffects"` と `dependencies: { dvascripting, dvauxpui }`、通信許可 `ws://localhost:*`)

### 方法 B: `.ccx` でインストール(AE 27 正式版向け)

```bash
npm run install:plugin       # ビルド → .ccx 作成 → Adobe の UPIA でインストール
```

`.ccx` は UXP 標準の配布形式で、Creative Cloud(UPIA)がインストールします(Creative Cloud へのサインインが必要)。
**AE 27 (Beta) では `-411`(対応アプリが見つからない)で失敗します**。Beta 版はインストール先として扱われないためと考えられるので、正式版リリース後に使ってください。
`.ccx` 内の manifest はパッケージ時に `host` を単一オブジェクトへ変換しています(配列のままだと `-4`)。

### 方法 C: UXP Developer Tool で読み込む(開発向け・AE 起動ごとに Load が必要)

UDT の **Add Plugin** → `apps/ae-plugin/dist/manifest.json` → **Load**。Creative Cloud へのサインインとメール確認が必要です。

## MCP 設定

パスはご自身の環境に合わせてください(下記は例)。

### Claude Code

```bash
claude mcp add roxy-ae --scope user -- node "I:/Programming/PF/Roxy AE Agent/apps/mcp-server/dist/index.js"
# 環境変数を渡す例
claude mcp add roxy-ae --scope user -e ROXY_LOG_LEVEL=debug -- node "I:/Programming/PF/Roxy AE Agent/apps/mcp-server/dist/index.js"
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.roxy-ae]
command = "node"
args = ["I:/Programming/PF/Roxy AE Agent/apps/mcp-server/dist/index.js"]
env = { ROXY_LOG_LEVEL = "info" }
```

### 環境変数

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `ROXY_AE_PORT` | `47820` | WebSocket Bridge のポート(パネルの Port と一致させる) |
| `ROXY_AE_HOST` | `127.0.0.1` | Bind アドレス(ローカル限定推奨) |
| `ROXY_AE_TOKEN` | なし | 設定するとパネル側にも同じ Token が必要 |
| `ROXY_TIMEOUT_MS` | `30000` | コマンド既定タイムアウト(Preview/Batch は個別に長め) |
| `ROXY_PREVIEW_DIR` | `%TEMP%/roxy-ae-agent/previews` | Preview PNG 出力先(AE が書き込める場所) |
| `ROXY_LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |
| `ROXY_LOG_FILE` | なし | ログをファイルにも追記 |
| `ROXY_FFPROBE` | PATH / `C:fmpegin` | `ae_render_verify` が使う ffprobe のパス |
| `ROXY_EXPERIMENTAL_MV` | 有効 | `0` で High-Level MV Tool(`mv_createLyricAnimation`)を非表示 |

## 接続確認

1. **MCP クライアントなしで確認**(MCP クライアントは停止しておく。ポートは1プロセスしか使えません)
   ```bash
   npm run diag
   ```
   Plugin 接続 → ping → プロジェクト概要 → Effect 一覧(先頭5件)を表示します。
2. **MCP クライアントから確認**: AI に「`ae_status` を実行して」と依頼。`connected: true` と AE バージョンが返れば OK。
3. Plugin パネルの状態表示が `connected` になっていること。

## 最小サンプル

AI への指示例(Phase 1 完成条件):

> 1920x1080 / 60fps / 5秒のCompositionを作成。中央にROXYというTextを置く。0秒ではOpacity 0、1秒でOpacity 100。1秒から3秒でScale 100から120。4秒から5秒でFade Out。Glowを追加。最後に2.5秒時点のPreview画像を取得。

AI は概ね次の順でツールを呼びます(`ae_batch_execute` 1回にまとめることも可能):

```
ae_comp_create        {name:"ROXY_TEST", width:1920, height:1080, duration:5, fps:60}
ae_text_create        {comp:"ROXY_TEST", text:"ROXY", name:"ROXY_TEXT"}
ae_keyframe_add       {comp:"ROXY_TEST", layer:"ROXY_TEXT", path:["transform","opacity"],
                       keys:[{time:0,value:0},{time:1,value:100},{time:4,value:100},{time:5,value:0}]}
ae_keyframe_add       {comp:"ROXY_TEST", layer:"ROXY_TEXT", path:["transform","scale"],
                       keys:[{time:1,value:100},{time:3,value:120}]}
ae_effect_listAvailable {filter:"glow"}   → matchName を確認
ae_effect_add         {comp:"ROXY_TEST", layer:"ROXY_TEXT", matchName:"<Glow の matchName>"}
ae_preview_frameAtTime {comp:"ROXY_TEST", time:2.5}  → imagePath / width / height / time / compName
```

AI を介さず同じシナリオを実行する: `npm run smoke`(MCP クライアント停止中に実行)。

## AI に任せて仕上げる(Phase 4)

Claude Code では次のスラッシュコマンドで始められます。

- `/mcp__roxy-ae__review_loop` … comp・目標・基準を渡すと、プレビュー → AI の評価 → 修正 → 再プレビューを回数上限つきで繰り返します(各回の前にチェックポイント。プロジェクトを一度保存しておくと巻き戻しが使えます)
- `/mcp__roxy-ae__autofix` … プロジェクトの問題を検出し、修正案を提示。**承認したものだけ**適用します

AI の評価は判断材料です。最終的な見た目の判断は AE 上でご自身で行ってください。

## 現在の制限事項

- **After Effects 実機での動作は未検証です。** 実装は AE UXP 公式ドキュメント(Early Preview)に基づき、Fake AE を使った統合テストで MCP→Bridge→Plugin の流れを検証していますが、実際の AE 上の挙動と映像の確認はユーザーが行う前提です。
- AE UXP は Early Preview のため、次の点はドキュメント未記載で**実機確認が必要**です:
  - `DeferredCall`(`saveFrameToPng` の戻り値)の待機方法 → サーバ側で PNG の書き込み完了をポーリングして確定
  - enum(`KeyframeInterpolationType` 等)の公開方法 → 取得できない場合は警告を返してその手順だけスキップ(数値の推測はしない)
- 対応は AE 27.0 以降のみ(AE 2024〜2026 は対象外)
- Keyframe の Ease は easyEase / easeIn / easeOut(影響 33.3%)のみ。速度・影響の数値指定は未対応
- テキストは Point Text のみ(Box Text 未対応)。テキストアニメーターは文字単位のみ(単語単位は未対応)
- Preview は単一フレーム PNG(複数時刻の一括取得可)。書き出しはレンダーキュー経由(aerender 未対応)
- `batch.execute` は失敗時に自動ロールバックしません(全体が1つの Undo グループなので Edit > Undo で一括で戻せます)
- MCP Server は1ポート1プロセス。Claude Code と Codex を**同時に**使う場合は `ROXY_AE_PORT` を分け、パネルの Port を切り替えてください
- 音声ファイルの読み込み・配置はできるが、音楽解析(BPM・ビート検出)・歌詞タイミング解析・AI Vision 判定・自動MV生成は未実装
