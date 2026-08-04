package main

import (
	"log"
	"os"

	"github.com/bwmarrin/discordgo"
	"github.com/famisics/fynsv/services/arona/discord-bot/fun-council/features/reminder"
	"github.com/famisics/fynsv/services/arona/discord-bot/fun-council/features/rolesync"
	"github.com/famisics/fynsv/services/arona/shared/logging"
	"github.com/famisics/fynsv/services/arona/shared/runutil"
)

var logger = logging.New()

func main() {
	token := os.Getenv("DISCORD_TOKEN")
	if token == "" {
		log.Fatal("DISCORD_TOKEN が設定されていません")
	}

	dg, err := discordgo.New("Bot " + token)
	if err != nil {
		log.Fatal("Discord セッションの作成に失敗しました:", err)
	}

	dg.AddHandler(reminder.Handler)

	if err := dg.Open(); err != nil {
		log.Fatal("接続に失敗しました:", err)
	}
	defer dg.Close()

	rolesync.Start(dg)

	existing, _ := dg.ApplicationCommands(dg.State.User.ID, "")
	registered := map[string]bool{reminder.Command.Name: true}
	for _, c := range existing {
		if !registered[c.Name] {
			if err := dg.ApplicationCommandDelete(dg.State.User.ID, "", c.ID); err != nil {
				logger.Error("不要なコマンドの削除に失敗しました", "command", c.Name, "error", err.Error())
			} else {
				logger.Info("不要なコマンド削除", "command", c.Name)
			}
		}
	}

	cmd, err := dg.ApplicationCommandCreate(dg.State.User.ID, "", reminder.Command)
	if err != nil {
		log.Fatalf("コマンド登録に失敗しました: %v", err)
	}
	logger.Info("コマンド登録", "command", reminder.Command.Name)

	logger.Info("Bot が起動しました")

	runutil.WaitForSignal()

	if err := dg.ApplicationCommandDelete(dg.State.User.ID, "", cmd.ID); err != nil {
		logger.Error("コマンド削除に失敗しました", "error", err.Error())
	}
}
