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

## 共通事項 (discord-bot/fun-council, discord-bot/uiroid, misskey-mixi2-link, swarm-gcal-sync)

- 新規 LXC は払い出さず、`arona` (VM 100) 上の Docker で常駐させる。外部公開はしない
- リソース割り当て (arona の cores / RAM 等) は [`../../terraform/`](../../terraform/) を正とする
- 前提: `arona` に SSH (`ssh arona`) で入れて Docker / Docker Compose v2 が使えること。ローカルに [Task](https://taskfile.dev/) と Go 1.25 があること (`task deploy:<name>` は `build:<name>` でローカル `go build` を実行してから転送するため、デプロイのみでも必須)
- デプロイ形式: Docker (`compose.yml`, `restart: unless-stopped`)。`task deploy:<name>` で services/arona からソース・Dockerfile・compose.yml・.env を転送し `docker compose up -d --build`
- 運用操作は配置先ディレクトリ `~/<dir>` に対して次のパターンで行う

  | 操作 | コマンド |
  | --- | --- |
  | ログ確認 | `ssh arona "cd ~/<dir> && docker compose logs -f"` |
  | 再起動 | `ssh arona "cd ~/<dir> && docker compose restart"` |
  | 再デプロイ | `task deploy:<name>` |
