package reminder

import (
	"fmt"
	"log"
	"time"

	"github.com/bwmarrin/discordgo"
)

var jst = time.FixedZone("Asia/Tokyo", 9*60*60)

var Command = &discordgo.ApplicationCommand{
	Name:        "remind",
	Description: "指定した時間(日本時間)にリマインダーを送信する",
	Options: []*discordgo.ApplicationCommandOption{
		{
			Type:        discordgo.ApplicationCommandOptionString,
			Name:        "message",
			Description: "リマインドするメッセージ",
			Required:    true,
		},
		{
			Type:        discordgo.ApplicationCommandOptionString,
			Name:        "time",
			Description: "リマインドする時刻 (例: 15:00, 06/24 09:30)",
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
	var message, timeStr string
	for _, opt := range options {
		switch opt.Name {
		case "message":
			message = opt.StringValue()
		case "time":
			timeStr = opt.StringValue()
		}
	}

	target, err := parseJST(timeStr)
	if err != nil {
		respondText(s, i, fmt.Sprintf("無効な時刻形式です: %s (例: 15:00, 06/24 09:30)", timeStr))
		return
	}

	delay := time.Until(target)
	if delay <= 0 {
		respondText(s, i, fmt.Sprintf("指定された時刻 %s はすでに過ぎています", target.Format("01/02 15:04")))
		return
	}

	channelID := i.ChannelID
	var userID string
	if i.Member != nil {
		userID = i.Member.User.ID
	} else if i.User != nil {
		userID = i.User.ID
	}

	time.AfterFunc(delay, func() {
		if _, err := s.ChannelMessageSend(channelID, fmt.Sprintf("<@%s> リマインド: %s", userID, message)); err != nil {
			log.Printf("リマインダー送信に失敗しました: %v", err)
		}
	})

	respondText(s, i, fmt.Sprintf("%s (JST) にリマインドします: %s", target.Format("01/02 15:04"), message))
}

func parseJST(s string) (time.Time, error) {
	now := time.Now().In(jst)

	// MM/DD HH:MM
	if t, err := time.ParseInLocation("01/02 15:04", s, jst); err == nil {
		t = t.AddDate(now.Year(), 0, 0)
		if t.Before(now) {
			t = t.AddDate(1, 0, 0)
		}
		return t, nil
	}

	// HH:MM
	if t, err := time.ParseInLocation("15:04", s, jst); err == nil {
		t = time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, jst)
		if t.Before(now) {
			t = t.AddDate(0, 0, 1)
		}
		return t, nil
	}

	return time.Time{}, fmt.Errorf("unsupported format: %s", s)
}

func respondText(s *discordgo.Session, i *discordgo.InteractionCreate, content string) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
		},
	})
}
