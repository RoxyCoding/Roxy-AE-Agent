# Roadmap

## Phase 1 — 基盤(現在)

- [x] TypeScript monorepo(npm workspaces)、MCP Server(stdio, SDK v2)、UXP Plugin(AE 27.0+)
- [x] WebSocket Bridge: ハンドシェイク、接続状態、Operation ID、Timeout、切断時の保留リクエスト失敗、ポート競合時の再試行
- [x] 共通 Request/Response、構造化エラー、タグ付きログ(debug 切替)
- [x] Selector(id / name / index / type / roxyId / role / tag、曖昧時は候補返却)
- [x] Roxy Metadata(comment 専用行)、lockedForAI 拒否
- [x] Phase 1 コマンド一式(project / comp / layer / text / transform / property / keyframe / effect / preview / undo)
- [x] batch.execute(1 Undo グループ、`$ref`、stop/continue、事前検証)
- [x] Preview: saveFrameToPng + PNG 完成待ち + 画像返却オプション
- [x] project-validator(Phase 1 ルール 7種)
- [x] mv-tools の構造 + 実験的 `mv_createLyricAnimation`
- [x] CLI: `diag`(接続確認)/ `smoke`(Phase 1 シナリオ)
- [ ] **実機 After Effects での検証(ユーザー)** ← 最優先

## Phase 2 — 制作の土台

- [ ] **実機差分の吸収**(AE 2026 + CEP 版での実機確認結果を反映)← 次に必要
- [x] Keyframe Ease(`keyframe.add` の `ease`)
- [x] 素材読み込み・配置(`footage.import`, `layer.addItem`、音声レイヤー type `audio`)
- [x] レイヤー作成(平面・ヌル・調整・シェイプ)、属性(タイミング・親子・スイッチ・描画モード)、重なり順
- [x] 汎用プリミティブ `property.addGroup` / `property.remove` / `property.setAttributes`
- [x] シェイプ(`ae_shape_create`)・マスク(`ae_mask_add`)・テキストアニメーター(`ae_text_addAnimator`)— サーバ側 plan で合成
- [x] `mv_createLyricAnimation` の文字単位 reveal と slide-up
- [x] Preview 複数時刻(`ae_preview_frames`)
- [x] Checkpoint(作成・一覧・復元、`project.open`)
- [x] Render(レンダーキュー、テンプレート指定)
- [x] Validator: missing-effects
- [ ] 速度・影響の数値指定 Ease、単語単位のテキストアニメーター(Based On の matchName 未確認)
- [ ] transaction(失敗時の自動ロールバック)— Undo の安全な実行方法が未確認のため保留
- [ ] Validator: invalid-layer-reference(現状は expressionError で検出)、render-settings
- [ ] aerender による Render、AE 2025/2026 の追加 API(ドロップダウン、文字種フォント)

## Phase 3 — MV 制作ツール

- `mv.createBeatPulse` / Beat 同期(音声解析パッケージ: BPM・オンセット検出 → マーカー)
- `mv.createGlitchTransition`, `mv.createParallaxScene`(2.5D, カメラ, 深度配置), `mv.createCameraSequence`
- `mv.createIntro` / `mv.createChorus` / `mv.createOutro`、MV 構成(セクション)自動作成
- 歌詞タイミング(LRC/SRT 読み込み)と歌詞アニメーションのプリセット化(`presets/`)
- サードパーティ Effect のプリセット(Deep Glow, Saber, Trapcode)を `effect.getProperties` の調査結果から生成

## Phase 4 — 自律ループ

- [x] レビューループ(`ae_review_start / record / capture / rollback / status`): 回ごとのチェックポイント、回数上限、JSON ログ
- [x] 客観チェック: PNG 解析(単色・暗すぎ)、前回との差分(変化なし)、Validator
- [x] 出力検証(`ae_render_verify`, ffprobe)
- [x] 承認つき自動修正(`ae_project_autofix`)
- [x] MCP プロンプト(`review_loop`, `autofix`)
- [ ] 評価基準のプリセット(MV 用: 歌詞の可読性、セーフエリア、ビートとの同期 など)— Phase 3 の解析結果と連携
- [ ] 動画全体のサンプリング(シーン切り替わり時刻を自動選択)
