package misskeydiscordlink

import (
	"fmt"
	"log/slog"

	"github.com/bwmarrin/discordgo"
)

var manageGuildPermission = int64(discordgo.PermissionManageGuild)

// Command is the "/misskey-link" slash command, exposing subcommands to
// configure the forward channel and watched hashtag.
var Command = &discordgo.ApplicationCommand{
	Name:                     "misskey-link",
	Description:              "Misskey のハッシュタグ投稿を Discord に転送する設定を管理する",
	DefaultMemberPermissions: &manageGuildPermission,
	Options: []*discordgo.ApplicationCommandOption{
		{
			Type:        discordgo.ApplicationCommandOptionSubCommand,
			Name:        "channel",
			Description: "転送先チャンネルを設定する",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionChannel,
					Name:        "channel",
					Description: "転送先チャンネル",
					Required:    true,
					ChannelTypes: []discordgo.ChannelType{
						discordgo.ChannelTypeGuildText,
					},
				},
			},
		},
		{
			Type:        discordgo.ApplicationCommandOptionSubCommand,
			Name:        "hashtag",
			Description: "監視するハッシュタグを設定する",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "name",
					Description: "ハッシュタグ (# は省略可)",
					Required:    true,
				},
			},
		},
		{
			Type:        discordgo.ApplicationCommandOptionSubCommand,
			Name:        "status",
			Description: "現在の設定を表示する",
		},
	},
}

// NewHandler returns an interaction handler for Command backed by store.
func NewHandler(store *Store, logger *slog.Logger) func(*discordgo.Session, *discordgo.InteractionCreate) {
	return func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		if i.Type != discordgo.InteractionApplicationCommand {
			return
		}
		data := i.ApplicationCommandData()
		if data.Name != Command.Name {
			return
		}
		if len(data.Options) == 0 {
			return
		}

		sub := data.Options[0]
		switch sub.Name {
		case "channel":
			handleSetChannel(s, i, store, logger, sub)
		case "hashtag":
			handleSetHashtag(s, i, store, logger, sub)
		case "status":
			handleStatus(s, i, store, logger)
		}
	}
}

func handleSetChannel(s *discordgo.Session, i *discordgo.InteractionCreate, store *Store, logger *slog.Logger, sub *discordgo.ApplicationCommandInteractionDataOption) {
	var channelID string
	for _, opt := range sub.Options {
		if opt.Name == "channel" {
			channelID = opt.ChannelValue(nil).ID
		}
	}
	if err := store.SetChannelID(channelID); err != nil {
		logger.Error("転送先チャンネルの保存に失敗しました", "error", err.Error())
		respondText(s, i, "転送先チャンネルの保存に失敗しました")
		return
	}
	respondText(s, i, fmt.Sprintf("転送先チャンネルを <#%s> に設定しました", channelID))
}

func handleSetHashtag(s *discordgo.Session, i *discordgo.InteractionCreate, store *Store, logger *slog.Logger, sub *discordgo.ApplicationCommandInteractionDataOption) {
	var hashtag string
	for _, opt := range sub.Options {
		if opt.Name == "name" {
			hashtag = opt.StringValue()
		}
	}
	hashtag = normalizeHashtag(hashtag)
	if hashtag == "" {
		respondText(s, i, "ハッシュタグを指定してください")
		return
	}
	if err := store.SetHashtag(hashtag); err != nil {
		logger.Error("ハッシュタグの保存に失敗しました", "error", err.Error())
		respondText(s, i, "ハッシュタグの保存に失敗しました")
		return
	}
	respondText(s, i, fmt.Sprintf("監視するハッシュタグを #%s に設定しました", hashtag))
}

func handleStatus(s *discordgo.Session, i *discordgo.InteractionCreate, store *Store, logger *slog.Logger) {
	hashtag, err := store.Hashtag()
	if err != nil {
		logger.Error("ハッシュタグの取得に失敗しました", "error", err.Error())
		respondText(s, i, "設定の取得に失敗しました")
		return
	}
	channelID, err := store.ChannelID()
	if err != nil {
		logger.Error("転送先チャンネルの取得に失敗しました", "error", err.Error())
		respondText(s, i, "設定の取得に失敗しました")
		return
	}

	hashtagDisplay := "(未設定)"
	if hashtag != "" {
		hashtagDisplay = "#" + hashtag
	}
	channelDisplay := "(未設定)"
	if channelID != "" {
		channelDisplay = fmt.Sprintf("<#%s>", channelID)
	}
	respondText(s, i, fmt.Sprintf("ハッシュタグ: %s\n転送先チャンネル: %s", hashtagDisplay, channelDisplay))
}

func respondText(s *discordgo.Session, i *discordgo.InteractionCreate, content string) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
		},
	})
}
