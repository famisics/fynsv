package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"slices"
	"syscall"

	"github.com/bwmarrin/discordgo"
)

var commands = []*discordgo.ApplicationCommand{
	{
		Name:        "grantrole",
		Description: "指定したロールを持つ全メンバーに別のロールを付与する",
		Options: []*discordgo.ApplicationCommandOption{
			{
				Type:        discordgo.ApplicationCommandOptionRole,
				Name:        "source",
				Description: "このロールを持つメンバーを対象にする",
				Required:    true,
			},
			{
				Type:        discordgo.ApplicationCommandOptionRole,
				Name:        "target",
				Description: "付与するロール",
				Required:    true,
			},
		},
	},
}

func main() {
	token := os.Getenv("DISCORD_TOKEN")
	if token == "" {
		log.Fatal("DISCORD_TOKEN が設定されていません")
	}

	dg, err := discordgo.New("Bot " + token)
	if err != nil {
		log.Fatal("Discord セッションの作成に失敗しました:", err)
	}

	dg.AddHandler(onInteraction)
	dg.Identify.Intents = discordgo.IntentsGuildMembers

	if err := dg.Open(); err != nil {
		log.Fatal("接続に失敗しました:", err)
	}
	defer dg.Close()

	registered := make([]*discordgo.ApplicationCommand, len(commands))
	for i, cmd := range commands {
		r, err := dg.ApplicationCommandCreate(dg.State.User.ID, "", cmd)
		if err != nil {
			log.Fatalf("コマンド '%v' の登録に失敗しました: %v", cmd.Name, err)
		}
		registered[i] = r
		log.Printf("コマンド登録: /%v", cmd.Name)
	}

	log.Println("Bot が起動しました。終了するには CTRL-C を押してください。")

	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	<-sc

	for _, cmd := range registered {
		if err := dg.ApplicationCommandDelete(dg.State.User.ID, "", cmd.ID); err != nil {
			log.Printf("コマンド '%v' の削除に失敗しました: %v", cmd.Name, err)
		}
	}
}

func onInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionApplicationCommand {
		return
	}
	if i.ApplicationCommandData().Name != "grantrole" {
		return
	}

	log.Printf("コマンド受信: GuildID=%q UserID=%q", i.GuildID, i.Member.User.ID)

	if i.GuildID == "" {
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "このコマンドはサーバー内でのみ使用できます。",
			},
		})
		return
	}

	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	}); err != nil {
		log.Println("Interaction の応答に失敗しました:", err)
		return
	}

	options := i.ApplicationCommandData().Options
	sourceRole := options[0].RoleValue(s, i.GuildID)
	targetRole := options[1].RoleValue(s, i.GuildID)

	count, err := grantRoleToMembers(s, i.GuildID, sourceRole.ID, targetRole.ID)
	var content string
	if err != nil {
		content = fmt.Sprintf("エラーが発生しました: %v", err)
	} else {
		content = fmt.Sprintf("**%s** を持つ %d 人に **%s** を付与しました。", sourceRole.Name, count, targetRole.Name)
	}

	if _, err := s.FollowupMessageCreate(i.Interaction, true, &discordgo.WebhookParams{
		Content: content,
	}); err != nil {
		log.Println("フォローアップメッセージの送信に失敗しました:", err)
	}
}

func grantRoleToMembers(s *discordgo.Session, guildID, sourceRoleID, targetRoleID string) (int, error) {
	var (
		after string
		count int
	)

	for {
		members, err := s.GuildMembers(guildID, after, 1000)
		if err != nil {
			return count, fmt.Errorf("メンバー取得に失敗しました: %w", err)
		}

		for _, member := range members {
			if !hasRole(member, sourceRoleID) {
				continue
			}
			if hasRole(member, targetRoleID) {
				continue
			}
			if err := s.GuildMemberRoleAdd(guildID, member.User.ID, targetRoleID); err != nil {
				if restErr, ok := err.(*discordgo.RESTError); ok && restErr.Message != nil && restErr.Message.Code == 50013 {
					return count, fmt.Errorf("権限が不足しています。Bot のロールを付与対象ロールより上位に移動してください")
				}
				log.Printf("ロール付与に失敗しました (user: %v): %v", member.User.Username, err)
				continue
			}
			count++
		}

		if len(members) < 1000 {
			break
		}
		after = members[len(members)-1].User.ID
	}

	return count, nil
}

func hasRole(member *discordgo.Member, roleID string) bool {
	return slices.Contains(member.Roles, roleID)
}
