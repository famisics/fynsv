package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/robfig/cron/v3"
)

// jst はスケジューラ用の固定タイムゾーン (JST は DST がないため FixedZone で十分)。
var jst = time.FixedZone("Asia/Tokyo", 9*60*60)

// incrementalLookback は毎日の増分同期で遡る範囲。tick 時刻のずれを吸収するため 1 時間重ねる。
const incrementalLookback = 25 * time.Hour

func main() {
	backfill := flag.Bool("backfill", false, "過去の全チェックインを取り込んで終了する")
	once := flag.Bool("once", false, "増分同期を 1 回だけ実行して終了する")
	googleAuth := flag.Bool("google-auth", false, "Google の OAuth 同意フローを実行し refresh token を表示する")
	foursquareAuth := flag.Bool("foursquare-auth", false, "Foursquare の OAuth フローを実行しユーザートークンを表示する")
	flag.Parse()

	ctx := context.Background()

	switch {
	case *googleAuth:
		if err := runGoogleAuth(ctx); err != nil {
			log.Fatal(err)
		}
		return
	case *foursquareAuth:
		if err := runFoursquareAuth(ctx); err != nil {
			log.Fatal(err)
		}
		return
	}

	app := newApp(ctx)

	switch {
	case *backfill:
		if err := app.backfill(); err != nil {
			log.Fatal(err)
		}
	case *once:
		if err := app.syncIncremental(); err != nil {
			log.Fatal(err)
		}
	default:
		app.runDaemon()
	}
}

type app struct {
	swarm *SwarmClient
	gcal  *GCalClient
}

func newApp(ctx context.Context) *app {
	durMin := 60
	if v := os.Getenv("EVENT_DURATION_MINUTES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			log.Fatalf("EVENT_DURATION_MINUTES が不正です: %q", v)
		}
		durMin = n
	}

	apiVersion := os.Getenv("FOURSQUARE_API_VERSION")
	if apiVersion == "" {
		apiVersion = "20240101"
	}

	swarm := NewSwarmClient(mustEnv("FOURSQUARE_OAUTH_TOKEN"), apiVersion)

	gcal, err := NewGCalClient(ctx,
		mustEnv("GOOGLE_CLIENT_ID"),
		mustEnv("GOOGLE_CLIENT_SECRET"),
		mustEnv("GOOGLE_REFRESH_TOKEN"),
		mustEnv("GOOGLE_CALENDAR_ID"),
		time.Duration(durMin)*time.Minute,
	)
	if err != nil {
		log.Fatal(err)
	}

	return &app{swarm: swarm, gcal: gcal}
}

// runDaemon は毎日 JST 0:00 に増分同期を実行し続ける。
func (a *app) runDaemon() {
	c := cron.New(cron.WithLocation(jst))
	if _, err := c.AddFunc("0 0 * * *", func() {
		if err := a.syncIncremental(); err != nil {
			log.Printf("増分同期に失敗: %v", err)
		}
	}); err != nil {
		log.Fatalf("cron 登録に失敗: %v", err)
	}
	c.Start()
	log.Println("起動しました。毎日 JST 0:00 に同期します")

	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	<-sc

	ctx := c.Stop()
	<-ctx.Done()
}

func (a *app) syncIncremental() error {
	after := time.Now().Add(-incrementalLookback).Unix()
	checkins, err := a.swarm.FetchSince(after)
	if err != nil {
		return err
	}
	return a.upsertAll(checkins, "増分")
}

func (a *app) backfill() error {
	checkins, err := a.swarm.FetchAll()
	if err != nil {
		return err
	}
	return a.upsertAll(checkins, "バックフィル")
}

func (a *app) upsertAll(checkins []Checkin, label string) error {
	var created, skipped int
	for _, c := range checkins {
		wasSkipped, err := a.gcal.UpsertCheckin(c)
		if err != nil {
			return err
		}
		if wasSkipped {
			skipped++
		} else {
			created++
		}
	}
	log.Printf("%s完了: %d 件取得 / %d 件登録 / %d 件スキップ", label, len(checkins), created, skipped)
	return nil
}
