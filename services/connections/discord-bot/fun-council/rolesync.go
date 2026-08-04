package main

import (
	"time"

	"github.com/bwmarrin/discordgo"
)

const (
	roleSyncInterval = 15 * time.Minute
	roleSyncGuildID  = "1518800617584197632"
)

// roleSyncRule は sourceRoleIDs のいずれかを持つメンバーへ targetRoleID を付与するルール。
type roleSyncRule struct {
	sourceRoleIDs map[string]bool
	targetRoleID  string
}

var roleSyncRules = []roleSyncRule{
	{
		sourceRoleIDs: map[string]bool{
			"1518915731062784010": true,
			"1518917362508759070": true,
			"1518960199623376937": true,
			"1518960330204512346": true,
			"1518960461561729064": true,
			"1518960558412529846": true,
			"1518960633368936559": true,
		},
		targetRoleID: "1523997133815021649",
	},
	{
		sourceRoleIDs: map[string]bool{
			"1518960889284395109": true,
			"1518968967215976508": true,
			"1518969164570558624": true,
			"1518969377427423232": true,
			"1518969493576093839": true,
			"1518969594860142593": true,
		},
		targetRoleID: "1523997191557873805",
	},
}

// startRoleSync は roleSyncRules に従いロールを付与するジョブを roleSyncInterval おきに実行する。
func startRoleSync(s *discordgo.Session) {
	go func() {
		for {
			runRoleSync(s)
			time.Sleep(roleSyncInterval)
		}
	}()
}

func runRoleSync(s *discordgo.Session) {
	added := 0
	after := ""
	for {
		members, err := s.GuildMembers(roleSyncGuildID, after, 1000)
		if err != nil {
			logger.Error("ロール同期: メンバー一覧の取得に失敗しました", "error", err.Error())
			return
		}
		if len(members) == 0 {
			break
		}
		for _, m := range members {
			after = m.User.ID
			for _, rule := range roleSyncRules {
				hasSource, hasTarget := false, false
				for _, r := range m.Roles {
					if rule.sourceRoleIDs[r] {
						hasSource = true
					}
					if r == rule.targetRoleID {
						hasTarget = true
					}
				}
				if hasSource && !hasTarget {
					if err := s.GuildMemberRoleAdd(roleSyncGuildID, m.User.ID, rule.targetRoleID); err != nil {
						logger.Error("ロール同期: ロール付与に失敗しました", "member", m.User.ID, "role", rule.targetRoleID, "error", err.Error())
						continue
					}
					added++
				}
			}
		}
		if len(members) < 1000 {
			break
		}
	}
	if added > 0 {
		logger.Info("ロール同期: ロールを付与しました", "count", added)
	}
}
