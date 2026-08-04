# connections

外部サービス (Discord / Misskey / mixi2) との連携・ブリッジをまとめたディレクトリ。各サービスの内部構築・運用は各サブディレクトリの README を正とする。

## 構成

| ディレクトリ | 役割 |
| --- | --- |
| [`discord-bot/`](./discord-bot/) | Discord bot (fun-council: リマインダー / ロール自動付与)。arona 上で Docker 常駐 |
| [`misskey/`](./misskey/README.md) | Misskey 本体 / PostgreSQL / Redis の 3 LXC 構成 |
| [`misskey-mixi2-link/`](./misskey-mixi2-link/README.md) | Misskey ⇔ mixi2 投稿ブリッジ。arona 上で Docker 常駐 |
| `shared/` | 複数サービスで共通利用する Go パッケージ (`shared/<サービス名>/...`) |

`go.mod` / `go.sum` / `Taskfile.yaml` はこのディレクトリを Go モジュールルートとして共有する
(`discord-bot/fun-council`, `discord-bot/rostercheck` が対象)。`misskey-mixi2-link/` は Bun/TypeScript の
独立プロジェクトで、Go モジュールには含まれない。
