#!/bin/bash
set -euo pipefail

# 勧誘会ロール付与スクリプト
# 「未来大サークル2025」Discordサーバー
# Guild ID: 1228211239830814770

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/fun-council-cli"

TOKEN="${DISCORD_TOKEN:?DISCORD_TOKEN が設定されていません}"
GUILD="${GUILD_ID:-1228211239830814770}"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[dry-run モード]"
fi

# 勧誘会ターゲットロール ID
PERF="1482555199171330108"  # 勧誘会_パフォーマンス（体育館）
EXP="1482555342779973772"   # 勧誘会_活動体験（食堂）
BOOTH="1482555269841162471" # 勧誘会_ブース展示

grant() {
  local label="$1" src="$2" target="$3"
  local args=(--source "$src" --target "$target")
  if $DRY_RUN; then args+=(--dry-run); fi
  local result
  result=$(DISCORD_TOKEN="$TOKEN" GUILD_ID="$GUILD" "$CLI" grant "${args[@]}" 2>&1)
  echo "$label: $result"
}

echo "=== パフォーマンス（体育館）==="
# ライブ参加サークル → 勧誘会_パフォーマンス（体育館）
grant "AC.brass-fun"        "1369807592800522350" "$PERF"
grant "AJ.オーケストラ同好会" "1372125885142012025" "$PERF"
grant "AK.一気狂う"          "1372125919883300956" "$PERF"
grant "AD.dance-sarfy"      "1372125663028314132" "$PERF"
grant "AB.函館学生連合〜息吹〜" "1369807216701477036" "$PERF"
grant "AP.軽音楽部"          "1372126066046533652" "$PERF"

echo ""
echo "=== 活動体験（食堂）==="
# 体験会参加サークル → 勧誘会_活動体験（食堂）
grant "AC.brass-fun"        "1369807592800522350" "$EXP"
grant "AJ.オーケストラ同好会" "1372125885142012025" "$EXP"
grant "BK.茶華道部"          "1372126648824238162" "$EXP"
grant "CE.djサークル"        "1372127222814736456" "$EXP"
grant "AP.軽音楽部"          "1372126066046533652" "$EXP"

echo ""
echo "=== ブース展示 ==="
# ブース参加サークル → 勧誘会_ブース展示
grant "AB.函館学生連合〜息吹〜" "1369807216701477036" "$BOOTH"
grant "CA.aiedu-japan-函館"  "1372127095232401408" "$BOOTH"
grant "AO.fun-bs"           "1372126044454387742" "$BOOTH"
grant "AL.funラジ"           "1372125947284689058" "$BOOTH"
grant "CI.ichigo鉄道"        "1372127329886933092" "$BOOTH"
grant "AM.illustrators"     "1372125978683375636" "$BOOTH"
grant "AS.mariconf"         "1372126157872566302" "$BOOTH"
grant "BB.sound-create"     "1372126282053320706" "$BOOTH"
grant "BA.スマブラの会"       "1372126246556663818" "$BOOTH"
grant "BL.ランニングサークル"  "1372126700304859247" "$BOOTH"
grant "BG.gatt"             "1372126521585569853" "$BOOTH"
grant "BE.ハードウェアサークル" "1372126456116678687" "$BOOTH"
grant "BQ.fun-coder"        "1372126879359959070" "$BOOTH"
grant "BC.自動車部"          "1372126314416439366" "$BOOTH"
grant "AA.生協学生委員会"     "1369501456016605290" "$BOOTH"
grant "BD.未来工房"          "1372126346888613918" "$BOOTH"
grant "AF.未来祭実行委員会"   "1369807070874042378" "$BOOTH"
grant "BF.麻雀サークル"      "1372126491084849152" "$BOOTH"
grant "BO.ポケモンだいすきクラブ" "1372126795100454933" "$BOOTH"
grant "CF.fungc"            "1372127252271333436" "$BOOTH"
grant "BM.スプラトゥーンサークル" "1372126730415902780" "$BOOTH"
grant "BS.硬式テニス部"      "1372127024453390347" "$BOOTH"
grant "BP.ガチャガチャサークル" "1372126850528186419" "$BOOTH"
grant "CN.FunFishing"       "1393413068683477012" "$BOOTH"
grant "DA.セパタクロー部"     "1479065176446730382" "$BOOTH"
grant "CQ.デザミ！"          "1460226375184285708" "$BOOTH"
grant "CR.未来大ボーカロイド同好会" "1475341504724598814" "$BOOTH"
grant "CM.Film・Uncut"       "1393412966409441300" "$BOOTH"

echo ""
echo "完了"
