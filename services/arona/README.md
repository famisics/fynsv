# arona

外部サービス (Discord / Misskey / mixi2) との連携・ブリッジをまとめたディレクトリ。各サービスの内部構築・運用は各サブディレクトリの README を正とする。

## 構成

| ディレクトリ | 役割 |
| --- | --- |
| [`discord-bot/`](./discord-bot/) | Discord bot (fun-council: リマインダー / ロール自動付与、uiroid: Misskey のハッシュタグ投稿を Discord に転送)。arona 上で Docker 常駐 |
| [`misskey-mixi2-link/`](./misskey-mixi2-link/README.md) | Misskey ⇔ mixi2 投稿ブリッジ。arona 上で Docker 常駐 |
| [`swarm-gcal-sync/`](./swarm-gcal-sync/README.md) | Swarm チェックイン → Google カレンダー同期。arona 上で Docker 常駐 |
| `shared/` | 複数サービスで共通利用する Go パッケージ (`shared/<パッケージ名>/...`)。`logging` (JSON ログ), `retry` (指数バックオフ), `runutil` (シグナル待ち), `misskey` (Misskey REST/streaming クライアント) |

`go.mod` / `go.sum` / `Taskfile.yaml` はこのディレクトリを Go モジュールルートとして共有する
(`discord-bot/fun-council`, `discord-bot/uiroid`, `misskey-mixi2-link`, `swarm-gcal-sync` が対象)。
