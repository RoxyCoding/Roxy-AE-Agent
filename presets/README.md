# presets/

High-Level MV Tool が使うプリセット置き場(Phase 3 で本格利用)。

予定している構成:

```
presets/
  mv/         歌詞アニメーション・トランジション等の動きのプリセット(JSON: Low-Level コマンド列のテンプレート)
  effects/    サードパーティ Effect の matchName / プロパティ既定値(effect.getProperties の調査結果から生成)
  looks/      色・グロー等のルック
```

プリセットは AE の .ffx ではなく、`batch.execute` のステップ列にコンパイルできる JSON として管理し、
AI が中身を読んで調整できる形にする方針です。
