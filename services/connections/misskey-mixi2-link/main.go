package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/tursodatabase/libsql-client-go/libsql"

	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/bridge"
	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/config"
	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/logging"
	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/mixi2"
	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/store"
	sharedmisskey "github.com/famisics/fynsv/services/connections/shared/misskey"
)

func openTursoDB(url, authToken string) (*sql.DB, error) {
	var opts []libsql.Option
	if authToken != "" {
		opts = append(opts, libsql.WithAuthToken(authToken))
	}
	connector, err := libsql.NewConnector(url, opts...)
	if err != nil {
		return nil, err
	}
	return sql.OpenDB(connector), nil
}

func main() {
	logger := logging.New()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	db, err := openTursoDB(cfg.TursoDatabaseURL, cfg.TursoAuthToken)
	if err != nil {
		log.Fatalf("open turso db: %v", err)
	}
	st, err := store.Open(db)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}

	mixi2Client, err := mixi2.NewClient(cfg.Mixi2ClientID, cfg.Mixi2ClientSecret, logger)
	if err != nil {
		log.Fatalf("create mixi2 client: %v", err)
	}
	misskeyUser := sharedmisskey.NewClient(cfg.MisskeyOrigin, cfg.MisskeyUserToken)
	misskeyBot := sharedmisskey.NewClient(cfg.MisskeyOrigin, cfg.MisskeyBotToken)

	// resolveUserId failure is fatal, matching the TS version, which lets
	// this throw uncaught rather than continuing in a half-configured state.
	misskeyUserID, err := misskeyUser.ResolveUserID(cfg.MisskeyUserID)
	if err != nil {
		log.Fatalf("resolve misskey user id: %v", err)
	}
	logger.Info("starting",
		"mixi2BotMention", cfg.Mixi2BotMention,
		"misskeyBotMention", cfg.MisskeyBotMention,
		"misskeyUserId", misskeyUserID,
		"dryRun", cfg.DryRun,
	)

	misskeyToMixi2 := bridge.NewMisskeyToMixi2(bridge.MisskeyToMixi2Deps{
		Store:               st,
		Misskey:             misskeyUser,
		Mixi2:               mixi2Client,
		MisskeyUserID:       misskeyUserID,
		MisskeyBotMention:   cfg.MisskeyBotMention,
		MisskeyPublicOrigin: cfg.MisskeyPublicOrigin,
		DryRun:              cfg.DryRun,
		Logger:              logger,
	})
	mixi2ToMisskey := bridge.NewMixi2ToMisskey(bridge.Mixi2ToMisskeyDeps{
		Store:      st,
		MisskeyBot: misskeyBot,
		OwnerName:  cfg.Mixi2UserID,
		BotMention: cfg.Mixi2BotMention,
		DryRun:     cfg.DryRun,
		Logger:     logger,
	})

	// backfill failure is non-fatal, matching the TS version: log and
	// continue with the live streams.
	if err := misskeyToMixi2.Backfill(); err != nil {
		logger.Error("backfill failed, continuing with streams", "error", err.Error())
	}

	misskeyWatcher := sharedmisskey.NewWatcher(
		cfg.MisskeyOrigin, cfg.MisskeyUserToken, misskeyUserID,
		misskeyToMixi2.HandleNote, logger,
	)
	misskeyWatcher.Start()

	mixi2Ctx, cancelMixi2 := context.WithCancel(context.Background())
	go mixi2Client.Watch(mixi2Ctx, mixi2ToMisskey.HandleMentionedPost, logger)

	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sc

	// Shutdown mirrors the TS version: no draining of in-flight work.
	logger.Info("shutting down", "signal", sig.String())
	misskeyWatcher.Stop()
	cancelMixi2()
	mixi2Client.Close()
	st.Close()
	os.Exit(0)
}
