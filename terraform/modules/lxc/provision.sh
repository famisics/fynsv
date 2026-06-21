#!/usr/bin/env bash
# 払い出し直後の最小 Debian LXC にベースラインを投入する。冪等・非対話。
# ssh <node> 'pct exec <vmid> -- bash -s' < provision.sh で stdin パイプ実行される。
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export LANG=C.UTF-8 LC_ALL=C.UTF-8 # ssh が転送する未生成ロケール由来の警告を抑止

# 起動直後は network/apt がまだ立っていないことがあるので軽くリトライする。
for _ in $(seq 1 10); do apt-get update -qq && break; sleep 3; done

apt-get install -y unzip git openssh-client curl sudo ca-certificates locales

# ja_JP.UTF-8 ロケールを生成して既定にする (locales パッケージが locale-gen に要る)。
sed -i 's/^# *ja_JP.UTF-8 UTF-8/ja_JP.UTF-8 UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=ja_JP.UTF-8

# タイムゾーンを Asia/Tokyo に。コンテナ内ログが JST 表記になる。
ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime
echo 'Asia/Tokyo' > /etc/timezone
