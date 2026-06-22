package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	discord "github.com/famisics/uiro/projects/fun-council-bot/internal/discord"
)

func fatalf(format string, args ...any) {
	msg := map[string]string{"error": fmt.Sprintf(format, args...)}
	json.NewEncoder(os.Stderr).Encode(msg)
	os.Exit(1)
}

func main() {
	if len(os.Args) < 2 {
		fatalf("サブコマンドを指定してください: list-roles | grant")
	}

	token := os.Getenv("DISCORD_TOKEN")
	if token == "" {
		fatalf("DISCORD_TOKEN が設定されていません")
	}

	switch os.Args[1] {
	case "list-roles":
		runListRoles(token, os.Args[2:])
	case "grant":
		runGrant(token, os.Args[2:])
	default:
		fatalf("不明なサブコマンド: %s", os.Args[1])
	}
}

func runListRoles(token string, args []string) {
	fs := flag.NewFlagSet("list-roles", flag.ExitOnError)
	guildID := fs.String("guild-id", os.Getenv("GUILD_ID"), "Guild ID")
	fs.Parse(args)

	if *guildID == "" {
		fatalf("--guild-id または GUILD_ID 環境変数を指定してください")
	}

	s, err := discord.NewSession(token)
	if err != nil {
		fatalf("%v", err)
	}
	defer s.Close()

	roles, err := discord.ListRoles(s, *guildID)
	if err != nil {
		fatalf("%v", err)
	}

	type roleOutput struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	out := make([]roleOutput, len(roles))
	for i, r := range roles {
		out[i] = roleOutput{ID: r.ID, Name: r.Name}
	}
	json.NewEncoder(os.Stdout).Encode(out)
}

func runGrant(token string, args []string) {
	fs := flag.NewFlagSet("grant", flag.ExitOnError)
	guildID := fs.String("guild-id", os.Getenv("GUILD_ID"), "Guild ID")
	sourceRoleID := fs.String("source", "", "ソースロール ID")
	targetRoleID := fs.String("target", "", "ターゲットロール ID")
	dryRun := fs.Bool("dry-run", false, "付与対象の確認のみ")
	fs.Parse(args)

	if *guildID == "" {
		fatalf("--guild-id または GUILD_ID 環境変数を指定してください")
	}
	if *sourceRoleID == "" {
		fatalf("--source を指定してください")
	}
	if *targetRoleID == "" {
		fatalf("--target を指定してください")
	}

	s, err := discord.NewSession(token)
	if err != nil {
		fatalf("%v", err)
	}
	defer s.Close()

	count, err := discord.GrantRoleToMembers(s, *guildID, *sourceRoleID, *targetRoleID, *dryRun)
	if err != nil {
		fatalf("%v", err)
	}

	type grantOutput struct {
		DryRun bool `json:"dry_run"`
		Count  int  `json:"count"`
	}
	json.NewEncoder(os.Stdout).Encode(grantOutput{DryRun: *dryRun, Count: count})
}
