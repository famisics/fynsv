package main

import (
  "log"
  "os"
  "os/signal"
  "syscall"

  "github.com/bwmarrin/discordgo"
  "github.com/famisics/fynsv/services/discord-bot/shared/reminder"
)

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

  cmd, err := dg.ApplicationCommandCreate(dg.State.User.ID, "", reminder.Command)
  if err != nil {
    log.Fatalf("コマンド登録に失敗しました: %v", err)
  }
  log.Printf("コマンド登録: /%s", reminder.Command.Name)

  log.Println("Bot が起動しました")

  sc := make(chan os.Signal, 1)
  signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
  <-sc

  if err := dg.ApplicationCommandDelete(dg.State.User.ID, "", cmd.ID); err != nil {
    log.Printf("コマンド削除に失敗しました: %v", err)
  }
}
