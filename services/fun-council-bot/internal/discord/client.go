package discord

import (
	"fmt"
	"log"
	"slices"

	"github.com/bwmarrin/discordgo"
)

func NewSession(token string) (*discordgo.Session, error) {
	s, err := discordgo.New("Bot " + token)
	if err != nil {
		return nil, fmt.Errorf("Discord セッションの作成に失敗しました: %w", err)
	}
	s.Identify.Intents = discordgo.IntentsGuildMembers
	if err := s.Open(); err != nil {
		return nil, fmt.Errorf("接続に失敗しました: %w", err)
	}
	return s, nil
}

func ListRoles(s *discordgo.Session, guildID string) ([]*discordgo.Role, error) {
	roles, err := s.GuildRoles(guildID)
	if err != nil {
		return nil, fmt.Errorf("ロール取得に失敗しました: %w", err)
	}
	return roles, nil
}

func ListMembers(s *discordgo.Session, guildID string) ([]*discordgo.Member, error) {
	var (
		after   string
		members []*discordgo.Member
	)
	for {
		batch, err := s.GuildMembers(guildID, after, 1000)
		if err != nil {
			return nil, fmt.Errorf("メンバー取得に失敗しました: %w", err)
		}
		members = append(members, batch...)
		if len(batch) < 1000 {
			break
		}
		after = batch[len(batch)-1].User.ID
	}
	return members, nil
}

func HasRole(member *discordgo.Member, roleID string) bool {
	return slices.Contains(member.Roles, roleID)
}

func GrantRoleToMembers(s *discordgo.Session, guildID, sourceRoleID, targetRoleID string, dryRun bool) (int, error) {
	members, err := ListMembers(s, guildID)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, member := range members {
		if !HasRole(member, sourceRoleID) {
			continue
		}
		if HasRole(member, targetRoleID) {
			continue
		}
		count++
		if dryRun {
			continue
		}
		if err := s.GuildMemberRoleAdd(guildID, member.User.ID, targetRoleID); err != nil {
			if restErr, ok := err.(*discordgo.RESTError); ok && restErr.Message != nil && restErr.Message.Code == 50013 {
				return count - 1, fmt.Errorf("権限が不足しています。Bot のロールを付与対象ロールより上位に移動してください")
			}
			log.Printf("ロール付与に失敗しました (user: %v): %v", member.User.Username, err)
			count--
		}
	}

	return count, nil
}
