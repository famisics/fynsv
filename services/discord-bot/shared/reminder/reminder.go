package reminder

import (
  "fmt"
  "log"
  "time"

  "github.com/bwmarrin/discordgo"
)

var Command = &discordgo.ApplicationCommand{
  Name:        "remind",
  Description: "指定した時間後にリマインダーを送信する",
  Options: []*discordgo.ApplicationCommandOption{
    {
      Type:        discordgo.ApplicationCommandOptionString,
      Name:        "message",
      Description: "リマインドするメッセージ",
      Required:    true,
    },
    {
      Type:        discordgo.ApplicationCommandOptionString,
      Name:        "duration",
      Description: "リマインドまでの時間 (例: 30m, 1h, 2h30m)",
      Required:    true,
    },
  },
}

func Handler(s *discordgo.Session, i *discordgo.InteractionCreate) {
  if i.Type != discordgo.InteractionApplicationCommand {
    return
  }
  if i.ApplicationCommandData().Name != Command.Name {
    return
  }

  options := i.ApplicationCommandData().Options
  var message, durationStr string
  for _, opt := range options {
    switch opt.Name {
    case "message":
      message = opt.StringValue()
    case "duration":
      durationStr = opt.StringValue()
    }
  }

  d, err := time.ParseDuration(durationStr)
  if err != nil {
    s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
      Type: discordgo.InteractionResponseChannelMessageWithSource,
      Data: &discordgo.InteractionResponseData{
        Content: fmt.Sprintf("無効な時間形式です: %s (例: 30m, 1h, 2h30m)", durationStr),
      },
    })
    return
  }

  channelID := i.ChannelID
  var userID string
  if i.Member != nil {
    userID = i.Member.User.ID
  } else if i.User != nil {
    userID = i.User.ID
  }

  time.AfterFunc(d, func() {
    if _, err := s.ChannelMessageSend(channelID, fmt.Sprintf("<@%s> リマインド: %s", userID, message)); err != nil {
      log.Printf("リマインダー送信に失敗しました: %v", err)
    }
  })

  s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
    Type: discordgo.InteractionResponseChannelMessageWithSource,
    Data: &discordgo.InteractionResponseData{
      Content: fmt.Sprintf("%s 後にリマインドします: %s", d, message),
    },
  })
}
