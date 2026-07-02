#!/usr/bin/env bash
# 使い方: PGPASSWORD=<ADMIN_PG_PASSWORD> ./create-db.sh <dbname>
# admin ロールで DB とそれ専用の LOGIN ロールを作成し、readonly ロールも合わせて用意したうえで接続文字列を出力する
set -euo pipefail

PGHOST="${PGHOST:-192.168.2.212}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-admin}"

if [ $# -ne 1 ]; then
  echo "usage: PGPASSWORD=<ADMIN_PG_PASSWORD> $0 <dbname>" >&2
  exit 1
fi

db="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

psql_admin() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 "$@"
}

exists="$(psql_admin -d postgres -tA -v db="$db" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'db'
SQL
)"
if [ "$exists" = "1" ]; then
  echo "error: database '$db' already exists" >&2
  exit 1
fi

password="$(openssl rand -hex 18)"

psql_admin -d postgres -v db="$db" -v password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'db') \gexec
SQL

psql_admin -d postgres -v db="$db" -f "$script_dir/../grants/readonly-role.sql"

echo "postgres://$db:$password@$PGHOST:$PGPORT/$db"
