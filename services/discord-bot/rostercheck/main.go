// rostercheck は球技大会の参加者名簿 (CSV) と Discord サーバーのメンバーを
// 氏名/ふりがなで突合し、サーバー参加状況と競技ロール付与状況を確認する読み取り専用ツール。
package main

import (
  "bufio"
  "encoding/csv"
  "flag"
  "fmt"
  "log"
  "os"
  "path/filepath"
  "slices"
  "strings"
  "unicode"

  "github.com/bwmarrin/discordgo"
  "golang.org/x/text/unicode/norm"
)

const guildID = "1518800617584197632"

type participant struct {
  team string
  name string
  kana string
}

func main() {
  envPath := flag.String("env", "", "DISCORD_TOKEN を含む .env ファイルのパス (省略時は環境変数 DISCORD_TOKEN を使用)")
  flag.Parse()

  if flag.NArg() != 1 {
    log.Fatal("使い方: rostercheck [-env path/to/.env] <名簿ディレクトリ>")
  }
  rosterDir := flag.Arg(0)

  token := os.Getenv("DISCORD_TOKEN")
  if *envPath != "" {
    t, err := readTokenFromEnvFile(*envPath)
    if err != nil {
      log.Fatalf(".env の読み込みに失敗しました: %v", err)
    }
    token = t
  }
  if token == "" {
    log.Fatal("DISCORD_TOKEN が設定されていません (-env で .env を指定するか環境変数を設定してください)")
  }

  s, err := discordgo.New("Bot " + token)
  if err != nil {
    log.Fatalf("Discord セッションの作成に失敗しました: %v", err)
  }

  members, err := fetchAllMembers(s)
  if err != nil {
    log.Fatalf("メンバー一覧の取得に失敗しました: %v", err)
  }
  roles, err := s.GuildRoles(guildID)
  if err != nil {
    log.Fatalf("ロール一覧の取得に失敗しました: %v", err)
  }

  files, err := filepath.Glob(filepath.Join(rosterDir, "*.csv"))
  if err != nil {
    log.Fatalf("名簿ディレクトリの読み込みに失敗しました: %v", err)
  }
  if len(files) == 0 {
    log.Fatalf("CSV ファイルが見つかりません: %s", rosterDir)
  }

  for _, f := range files {
    competition := competitionNameFromFile(f)
    participants, err := parseRoster(f)
    if err != nil {
      log.Printf("%s のパースに失敗しました: %v", f, err)
      continue
    }
    role := findCompetitionRole(roles, competition)
    printReport(competition, participants, members, role)
  }
}

// readTokenFromEnvFile は KEY=VALUE 形式の .env から DISCORD_TOKEN を読み取る。
func readTokenFromEnvFile(path string) (string, error) {
  f, err := os.Open(path)
  if err != nil {
    return "", err
  }
  defer f.Close()

  scanner := bufio.NewScanner(f)
  for scanner.Scan() {
    line := strings.TrimSpace(scanner.Text())
    if line == "" || strings.HasPrefix(line, "#") {
      continue
    }
    k, v, ok := strings.Cut(line, "=")
    if ok && strings.TrimSpace(k) == "DISCORD_TOKEN" {
      return strings.TrimSpace(v), nil
    }
  }
  return "", scanner.Err()
}

// fetchAllMembers は GuildMembers をページネーションしながら全メンバーを取得する。
func fetchAllMembers(s *discordgo.Session) ([]*discordgo.Member, error) {
  var all []*discordgo.Member
  after := ""
  for {
    members, err := s.GuildMembers(guildID, after, 1000)
    if err != nil {
      return nil, err
    }
    if len(members) == 0 {
      break
    }
    all = append(all, members...)
    after = members[len(members)-1].User.ID
    if len(members) < 1000 {
      break
    }
  }
  return all, nil
}

// competitionNameFromFile は "R8球技大会参加者名簿 - サッカー.csv" のようなファイル名から競技名を取り出す。
func competitionNameFromFile(path string) string {
  base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
  if _, after, ok := strings.Cut(base, " - "); ok {
    return strings.TrimSpace(after)
  }
  return base
}

// parseRoster は名簿 CSV をパースする。1 行目はタイトル、2 行目は空行、3 行目はヘッダで、
// 4 行目以降がメンバー行。チーム名セルは結合セル由来で先頭行のみ値を持つため直前の値を引き継ぐ。
func parseRoster(path string) ([]participant, error) {
  f, err := os.Open(path)
  if err != nil {
    return nil, err
  }
  defer f.Close()

  r := csv.NewReader(f)
  r.FieldsPerRecord = -1
  records, err := r.ReadAll()
  if err != nil {
    return nil, err
  }
  if len(records) < 3 {
    return nil, fmt.Errorf("行数が不足しています")
  }

  var participants []participant
  currentTeam := ""
  for _, rec := range records[3:] {
    if len(rec) < 4 {
      continue
    }
    if team := cleanTeamName(rec[0]); team != "" {
      currentTeam = team
    }
    name := strings.TrimSpace(rec[2])
    kana := strings.TrimSpace(rec[3])
    if name == "" {
      continue
    }
    participants = append(participants, participant{team: currentTeam, name: name, kana: kana})
  }
  return participants, nil
}

// cleanTeamName はチーム名セル ("チーム名\nふりがな                " のような複数行+末尾空白) から
// 1 行目のチーム名部分だけを取り出す。
func cleanTeamName(raw string) string {
  line, _, _ := strings.Cut(raw, "\n")
  return strings.TrimSpace(line)
}

// normalize は氏名/ふりがな/表示名の突合のため、空白を除去し Unicode 正規化 (NFC) を揃える。
// macOS のファイルシステムは濁点・半濁点を分解した NFD でファイル名を返すため、
// NFC で保存されている Discord 側のロール名・表示名と単純比較すると一致しない。
func normalize(s string) string {
  s = norm.NFC.String(s)
  return strings.Map(func(r rune) rune {
    if r == ' ' || r == '　' || r == '\t' {
      return -1
    }
    return r
  }, s)
}

// competitionRoleShortName は "出場者：ソフト🥎" のような出場者ロール名から
// 末尾の絵文字を除いた短縮競技名 ("ソフト") を取り出す。出場者ロールでなければ空文字を返す。
func competitionRoleShortName(roleName string) string {
  prefix, name, ok := strings.Cut(roleName, "：")
  if !ok || prefix != "出場者" {
    return ""
  }
  return strings.TrimRightFunc(name, func(r rune) bool {
    return !unicode.IsLetter(r) && !unicode.IsNumber(r)
  })
}

// findCompetitionRole は「出場者：<競技名の略称>」形式のロールを競技名との部分一致 (双方向) で検索する。
// 運営協力ロール等は対象外。一致が 0 件または複数件の場合は nil を返し、呼び出し側で警告表示させる。
func findCompetitionRole(roles []*discordgo.Role, competition string) *discordgo.Role {
  normComp := normalize(competition)
  var matched []*discordgo.Role
  for _, role := range roles {
    short := normalize(competitionRoleShortName(role.Name))
    if short == "" {
      continue
    }
    if strings.Contains(normComp, short) || strings.Contains(short, normComp) {
      matched = append(matched, role)
    }
  }
  if len(matched) != 1 {
    if len(matched) > 1 {
      names := make([]string, len(matched))
      for i, r := range matched {
        names[i] = r.Name
      }
      fmt.Printf("警告: 「%s」に一致するロールが複数見つかりました (%s)。ロール判定はスキップします。\n", competition, strings.Join(names, ", "))
    } else {
      fmt.Printf("警告: 「%s」に一致するロールが見つかりません。ロール判定はスキップします。\n", competition)
    }
    return nil
  }
  return matched[0]
}

// memberDisplayName は Nick → GlobalName → Username の優先順で表示名を返す。
func memberDisplayName(m *discordgo.Member) string {
  if m.Nick != "" {
    return m.Nick
  }
  if m.User.GlobalName != "" {
    return m.User.GlobalName
  }
  return m.User.Username
}

// findMatchingMembers は氏名またはふりがなが表示名に部分一致するメンバーを列挙する。
func findMatchingMembers(members []*discordgo.Member, p participant) []*discordgo.Member {
  normName := normalize(p.name)
  normKana := normalize(p.kana)
  var matched []*discordgo.Member
  for _, m := range members {
    display := normalize(memberDisplayName(m))
    if display == "" {
      continue
    }
    if (normName != "" && strings.Contains(display, normName)) ||
      (normKana != "" && strings.Contains(display, normKana)) {
      matched = append(matched, m)
    }
  }
  return matched
}

func hasRole(m *discordgo.Member, roleID string) bool {
  return slices.Contains(m.Roles, roleID)
}

func printReport(competition string, participants []participant, members []*discordgo.Member, role *discordgo.Role) {
  fmt.Printf("\n=== %s (%d 名) ===\n", competition, len(participants))

  joined, roleGranted, notFound := 0, 0, 0
  for _, p := range participants {
    matched := findMatchingMembers(members, p)

    status := "✗ 未発見"
    roleStatus := "-"
    switch len(matched) {
    case 0:
      notFound++
    case 1:
      status = fmt.Sprintf("✓ (%s)", memberDisplayName(matched[0]))
      joined++
      if role != nil {
        if hasRole(matched[0], role.ID) {
          roleStatus = "✓"
          roleGranted++
        } else {
          roleStatus = "✗"
        }
      }
    default:
      names := make([]string, len(matched))
      for i, m := range matched {
        names[i] = memberDisplayName(m)
      }
      status = fmt.Sprintf("曖昧 (%s)", strings.Join(names, ", "))
      joined++
    }

    fmt.Printf("%-12s %-8s サーバー参加: %-30s ロール: %s\n", p.name, p.team, status, roleStatus)
  }

  fmt.Printf("--- サマリ: 名簿 %d 名 / 参加確認 %d 名 / ロール付与 %d 名 / 未発見 %d 名 ---\n",
    len(participants), joined, roleGranted, notFound)
}
