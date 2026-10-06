# Commands / MCP Tools

コマンド名(Plugin 側)と MCP ツール名の対応です。ツール名は `ae_` + コマンド名の `.` を `_` に置換(例外: `project.getState` → `ae_get_project_state`)。
引数の正確な定義は `packages/ae-protocol/src/commands/*.ts`(zod)が唯一の真実で、MCP の inputSchema にもそのまま使われます。

共通:
- `comp`: Comp Selector(`"名前"` / id / `{id,name,roxyId,active}`)。省略 = アクティブComp
- `layer`: Layer Selector(`"名前"` / id / `{id,name,index,type,roxyId,role,tag}`)
- `path`: プロパティパス。配列(matchName 推奨・表示名・1始まり index)または `"a/b"`。エイリアス `transform` `effects` `text` `masks`、Transform 内 `anchorPoint` `position` `scale` `rotation` `opacity` 等
- 時間はすべて**Comp 時間の秒**

## System

| Tool | Command | 説明 |
| --- | --- | --- |
| `ae_status` | (server) + `system.ping` | Bridge/Plugin 接続状態、AE バージョン、ping |

## Project

| Tool | Command | 主な引数 | 説明 |
| --- | --- | --- | --- |
| `ae_get_project_state` | `project.getState` | `detail: summary\|detailed`, `comp`, `compLimit` | summary: プロジェクト情報・アクティブComp・Comp一覧(id/name/layer数)。detailed: Comp設定 + **1つのComp**のレイヤー一覧 + エラー |
| `ae_project_save` | `project.save` | `path?` | 未保存プロジェクトは `path` 必須(保存ダイアログでブロックしないため) |
| `ae_project_validate` | `project.collectDiagnostics` + validator | `comp?`, `rules?`, `maxIssues` | 診断レポート |
| `ae_metadata_get` | `metadata.get` | `comp`, `layer?` | Roxy Metadata 取得 |
| `ae_metadata_set` | `metadata.set` | `comp`, `layer?`, `metadata` | マージ。`lockedForAI` は true にのみ変更可 |

## Composition

| Tool | Command | 主な引数 | 説明 |
| --- | --- | --- | --- |
| `ae_comp_create` | `comp.create` | `name,width,height,duration,fps`, `pixelAspect=1`, `bgColor?`, `open=true`, `allowDuplicateName=false`, `roxy?` | 同名があれば `CONFLICT`。返却 `{compId, comp}` |
| `ae_comp_get` | `comp.get` | `comp`, `includeLayers=true` | 設定 + レイヤー一覧 |
| `ae_comp_list` | `comp.list` | `filter?`, `limit` | Comp 一覧 |

## Layer / Text

| Tool | Command | 主な引数 | 説明 |
| --- | --- | --- | --- |
| `ae_layer_list` | `layer.list` | `comp`, `type?`, `limit` | 概要(id, index, name, type, in/out, parentId, roxy) |
| `ae_layer_get` | `layer.get` | `comp`, `layer` | 概要 + Transform値 + Effect一覧 + comment |
| `ae_layer_delete` | `layer.delete` | `comp`, `layer`, `dryRun=false` | 削除前スナップショットを返却 |
| `ae_layer_duplicate` | `layer.duplicate` | `comp`, `layer`, `newName?`, `roxyId?` | 複製側の roxyId は消去(指定時は付与) |
| `ae_text_create` | `text.create` | `comp`, `text`, `name?`, `position?`, `fontSize?`, `font?`(PostScript名), `fillColor?`([r,g,b] 0-1), `justification=center`, `centerAnchor=true`, `roxy?` | Point Text。アンカーをテキスト範囲中央へ移し、既定でComp中央に配置 |
| `ae_text_setText` | `text.setText` | `comp`, `layer`, `text`, `time?` | 書式を保ったまま文字列変更。`time` で Source Text キーフレーム |

## Transform / Property / Keyframe

| Tool | Command | 主な引数 | 説明 |
| --- | --- | --- | --- |
| `ae_transform_get` | `transform.get` | `comp`, `layer`, `time?` | anchorPoint, position, scale, rotation, opacity(3Dなら orientation 等)とキー数 |
| `ae_transform_set` | `transform.set` | `comp`, `layer`, `values{...}`, `time?` | `time` 無し=静的値(キーフレームがあるとエラー)、有り=キーフレーム |
| `ae_property_get` | `property.get` | `comp`, `layer`, `path?`, `time?`, `depth=1` | プロパティ/グループの調査(name, matchName, value, min/max, キー数, expression)。`path` 省略でトップレベル |
| `ae_property_set` | `property.set` | `comp`, `layer`, `path`, `value?`, `time?`, `expression?` | 値 and/or Expression。`expressionError` を返却 |
| `ae_keyframe_add` | `keyframe.add` | `comp`, `layer`, `path`, `keys:[{time,value,interpolation?,ease?}]` | 複数キーを1回で。ベクトルに数値1つ → 全軸に展開。`ease`: `easyEase` / `easeIn` / `easeOut`(影響 33.3%、指定しない側は現状維持) |
| `ae_keyframe_remove` | `keyframe.remove` | `comp`, `layer`, `path`, `time`\|`keyIndex`\|`all`, `dryRun` | 削除したキー(time,value)を返却。`time` は半フレーム以内で一致 |

値の型合わせ(Plugin 側):
- `scale: 120` → `[120,120]`(3Dなら3軸)
- 3軸プロパティに `[x,y]` → 現在の z を補完(warning)
- Source Text に文字列 or `{text, font, fontSize, fillColor, ...}`

## Effect

| Tool | Command | 主な引数 | 説明 |
| --- | --- | --- | --- |
| `ae_effect_listAvailable` | `effect.listAvailable` | `filter?`, `category?`, `offset`, `limit=50` | `app.effects` から(サードパーティ含む)。displayName / **matchName** / category |
| `ae_effect_listOnLayer` | `effect.listOnLayer` | `comp`, `layer` | 適用済み Effect(index, name, matchName, enabled) |
| `ae_effect_add` | `effect.add` | `comp`, `layer`, `matchName`(推奨)\|`displayName`, `name?` | 表示名は完全一致1件のみ許可(ローカライズされるため matchName 推奨)。追加後のプロパティ一覧を返却 |
| `ae_effect_getProperties` | `effect.getProperties` | `comp`, `layer`, `effect`, `depth=2`, `time?` | Effect のプロパティツリー |
| `ae_effect_setProperty` | `effect.setProperty` | `comp`, `layer`, `effect`, `property`, `value?`, `time?`, `expression?` | `effect` は名前 / index / `{index,name,matchName}` |

Effect 名・プロパティはハードコードしていません。AI は `listAvailable` → `add` → `getProperties` → `setProperty` の順で調べながら操作します(Deep Glow・Saber・Trapcode 等も同じ流れ)。

## Preview

| Tool | 内部 Command | 主な引数 | 返却 |
| --- | --- | --- | --- |
| `ae_preview_frameAtTime` | `comp.get` + `preview.renderFrame` | `comp`, `time`, `draft=false`, `returnImage=false` | `imagePath, width, height, time, compName, compId` |
| `ae_preview_currentFrame` | 同上 | `comp`, `draft`, `returnImage` | 同上(Comp の現在時間) |

## Undo

| Tool | Command | 説明 |
| --- | --- | --- |
| `ae_undo_beginGroup` | `undo.beginGroup` | `name`。明示 Undo グループ開始(二重開始は `CONFLICT`) |
| `ae_undo_endGroup` | `undo.endGroup` | 明示グループ終了 |

## Batch

| Tool | Command | 説明 |
| --- | --- | --- |
| `ae_batch_execute` | `batch.execute` | `commands[{id?,command,args}]`(最大500), `onError=stop\|continue`, `undoGroup`。詳細は [ARCHITECTURE.md](ARCHITECTURE.md#batch) |

## Phase 2: 素材・レイヤー構造

| Tool | Command | 主な引数 | 説明 |
| --- | --- | --- | --- |
| `ae_footage_import` | `footage.import` | `path`, `name?` | 音声・動画・画像を読み込み。返却 `item{id,name,duration,hasAudio,hasVideo}` |
| `ae_layer_addItem` | `layer.addItem` | `comp`, `item`(名前/id/{id,name}), `startTime?`, `name?` | 読み込んだ素材や別コンポをレイヤーとして配置。音声のみの素材は type `audio` |
| `ae_layer_create` | `layer.create` | `comp`, `kind: solid|null|adjustment|shape`, `name?`, `color?`, `width?`, `height?` | 平面・ヌル・調整レイヤー・空のシェイプレイヤー |
| `ae_layer_set` | `layer.set` | `comp`, `layer`, `attributes{name,startTime,inPoint,outPoint,stretch,parent,enabled,threeD,motionBlur,adjustmentLayer,shy,solo,label,blendingMode}` | `parent` はレイヤー Selector か null。`blendingMode` は BlendingMode 名(ADD, SCREEN …) |
| `ae_layer_reorder` | `layer.reorder` | `comp`, `layer`, `to: top|bottom|{above}|{below}` | 重なり順の変更 |
| `ae_property_addGroup` | `property.addGroup` | `comp`, `layer`, `path`(親), `matchName`, `name?`, `reuseExisting?` | 汎用: マスク・シェイプ・テキストアニメーター等を追加。返却 `index`(後続パスに使う) |
| `ae_property_remove` | `property.remove` | `comp`, `layer`, `path`, `dryRun` | エフェクト/マスク/アニメーター等の削除(内容を返却) |
| `ae_property_setAttributes` | `property.setAttributes` | `path`, `attributes{name,enabled,maskMode,inverted}` | キーフレームにできない属性(マスクモード等) |
| `ae_shape_create` | (plan) | `comp`, `type: rect|ellipse`, `size`, `position?`, `fillColor?`, `strokeColor?`, `strokeWidth?`, `roundness?` | シェイプレイヤー + 長方形/楕円 + 塗り/線 を1回の batch で |
| `ae_mask_add` | (plan) | `comp`, `layer`, `rect|ellipse|path`(レイヤー座標), `mode?`, `inverted?`, `name?` | マスク追加 |
| `ae_text_addAnimator` | (plan) | `comp`, `layer`, `properties{opacity,position,scale,rotation,tracking,blur}`, `reveal?{start,duration,direction,ease}` | 文字単位アニメーション。`reveal` で範囲セレクターをスイープ(1文字ずつ表示/消去) |
| `ae_preview_frames` | `preview.renderFrame` ×N | `comp`, `times[]`(最大12), `returnImage` | 複数時刻の一括プレビュー |
| `ae_render_comp` | `render.comp` | `comp`, `outputPath`, `template?`(名前 or 部分一致), `startTime?`, `duration?` | レンダーキューで書き出し(完了まで AE はブロック)。他のキュー項目は一時停止→復元 |
| `ae_checkpoint_create` | save + コピー | `label?` | 保存して `<プロジェクトのフォルダ>/roxy_checkpoints/` にコピー |
| `ae_checkpoint_list` | | | チェックポイント一覧(新しい順) |
| `ae_checkpoint_restore` | open | `checkpoint`, `discardChanges` | 現在のファイルを before-restore として退避 → 上書き → 開き直す。未保存変更があると拒否 |
| `ae_project_open` | `project.open` | `path`, `discardChanges` | プロジェクトを開く(未保存変更があると拒否) |

「(plan)」のツールは AE 側に専用コマンドを持たず、汎用コマンド(`layer.create` / `property.addGroup` / `property.set` / `property.setAttributes` / `keyframe.add`)の組み合わせを1回の `batch.execute` で実行します(1つの Undo)。

## Phase 4: 自律ループ・検証・自動修正

| Tool | 主な引数 | 説明 |
| --- | --- | --- |
| `ae_review_start` | `comp`, `goal`, `criteria[]`, `times?`/`frameCount`, `maxIterations=3`, `returnImage=true` | レビュー開始。ベースラインのチェックポイント → サンプル時刻のフレーム → 客観チェック(真っ黒/単色、暗すぎ、Validator)を返す |
| `ae_review_record` | `sessionId`, `verdict: pass|fix|stop`, `evaluations[]`, `plannedChanges` | AI の評価を記録。fix ならチェックポイントを取ってから修正へ。上限到達で停止しユーザーに確認 |
| `ae_review_capture` | `sessionId`, `returnImage` | 修正後に同じ時刻を再取得。前回との差分(変化なし検出)つき |
| `ae_review_rollback` | `sessionId`, `iteration`(-1 = ベースライン) | その回の修正前のチェックポイントに戻す |
| `ae_review_status` | `sessionId?` | セッションの記録(`<previews の親>/reviews/<id>.json` にも保存) |
| `ae_render_verify` | `path`, `expect{durationSec,width,height,fps,hasAudio,minSizeBytes}` | ffprobe で書き出しファイルを検証(`ROXY_FFPROBE` / PATH / `C:fmpegin`) |
| `ae_project_autofix` | `comp?`, `apply?: [ids]` | 承認つき自動修正。`apply` なしで修正案を返すだけ。ユーザーが承認した id だけ `apply` で実行(事前にチェックポイント、1つの Undo)。対象: 重複 roxyId の改名、壊れたエクスプレッションの無効化(削除しない)、未インストールエフェクトの削除 |

MCP プロンプト(Claude Code ではスラッシュコマンド): `/mcp__roxy-ae__review_loop`(comp, goal, criteria, maxIterations)、`/mcp__roxy-ae__autofix`(comp)。

## High-Level(標準で有効、`ROXY_EXPERIMENTAL_MV=0` で非表示)

| Tool | 説明 |
| --- | --- |
| `mv_createLyricAnimation` | `text, start, duration, reveal=line, entrance=fade\|scale-pop\|none, exit=fade\|none`。未実装オプション(character/word reveal, glitch exit, slide-up)は `UNSUPPORTED` |
