package main

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"

	"github.com/bwmarrin/discordgo"

	"github.com/famisics/fynsv/services/connections/discord-bot/uiroid/config"
	misskeydiscordlink "github.com/famisics/fynsv/services/connections/discord-bot/uiroid/features/misskey-discord-link"
	"github.com/famisics/fynsv/services/connections/shared/logging"
	sharedmisskey "github.com/famisics/fynsv/services/connections/shared/misskey"
	"github.com/famisics/fynsv/services/connections/shared/runutil"
)

func main() {
	logger := logging.New()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("sqlite", cfg.DBPath)
	if err != nil {
		log.Fatalf("open sqlite db: %v", err)
	}
	defer db.Close()

	store, err := misskeydiscordlink.Open(db)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}

	dg, err := discordgo.New("Bot " + cfg.DiscordToken)
	if err != nil {
		log.Fatal("Discord セッションの作成に失敗しました:", err)
	}

	dg.AddHandler(misskeydiscordlink.NewHandler(store, logger))

	if err := dg.Open(); err != nil {
		log.Fatal("接続に失敗しました:", err)
	}
	defer dg.Close()

	existing, _ := dg.ApplicationCommands(dg.State.User.ID, "")
	registered := map[string]bool{misskeydiscordlink.Command.Name: true}
	for _, c := range existing {
		if !registered[c.Name] {
			if err := dg.ApplicationCommandDelete(dg.State.User.ID, "", c.ID); err != nil {
				logger.Error("不要なコマンドの削除に失敗しました", "command", c.Name, "error", err.Error())
			} else {
				logger.Info("不要なコマンド削除", "command", c.Name)
			}
		}
	}

	cmd, err := dg.ApplicationCommandCreate(dg.State.User.ID, "", misskeydiscordlink.Command)
	if err != nil {
		log.Fatalf("コマンド登録に失敗しました: %v", err)
	}
	logger.Info("コマンド登録", "command", misskeydiscordlink.Command.Name)

	misskeyClient := sharedmisskey.NewClient(cfg.MisskeyOrigin, cfg.MisskeyUserToken)
	misskeyUserID, err := misskeyClient.ResolveUserID(cfg.MisskeyUserID)
	if err != nil {
		log.Fatalf("resolve misskey user id: %v", err)
	}

	bridge := misskeydiscordlink.NewBridge(misskeydiscordlink.BridgeDeps{
		Store:               store,
		Misskey:             misskeyClient,
		Discord:             dg,
		MisskeyUserID:       misskeyUserID,
		MisskeyPublicOrigin: cfg.MisskeyPublicOrigin,
		Logger:              logger,
	})

	if err := bridge.Backfill(); err != nil {
		logger.Error("backfill failed, continuing with stream", "error", err.Error())
	}

	watcher := sharedmisskey.NewWatcher(cfg.MisskeyOrigin, cfg.MisskeyUserToken, misskeyUserID, bridge.HandleNote, logger)
	watcher.Start()

	logger.Info("Bot が起動しました", "misskeyUserId", misskeyUserID)

	sig := runutil.WaitForSignal()
	logger.Info("shutting down", "signal", sig.String())

	watcher.Stop()

	if err := dg.ApplicationCommandDelete(dg.State.User.ID, "", cmd.ID); err != nil {
		logger.Error("コマンド削除に失敗しました", "error", err.Error())
	}
}
