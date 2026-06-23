package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
)

// calendarScope は対象カレンダーのイベント読み書きに必要な最小スコープ。
const calendarScope = calendar.CalendarEventsScope

// GCalClient は専用カレンダーへチェックインを書き込むクライアント。
type GCalClient struct {
	svc           *calendar.Service
	calendarID    string
	eventDuration time.Duration
}

// NewGCalClient はサービスアカウント鍵で Calendar サービスを生成する。
// 対象カレンダーを SA のメールアドレスに「予定の変更権限」で共有しておくこと。
func NewGCalClient(ctx context.Context, credentialsFile, calendarID string, eventDuration time.Duration) (*GCalClient, error) {
	svc, err := calendar.NewService(ctx,
		option.WithCredentialsFile(credentialsFile),
		option.WithScopes(calendarScope),
	)
	if err != nil {
		return nil, fmt.Errorf("calendar サービスの生成に失敗: %w", err)
	}
	return &GCalClient{svc: svc, calendarID: calendarID, eventDuration: eventDuration}, nil
}

// UpsertCheckin はチェックインを 1 件カレンダーに登録する。
// 既に同じイベントがあれば (409) スキップし、true を返す。
func (g *GCalClient) UpsertCheckin(c Checkin) (skipped bool, err error) {
	ev := g.checkinToEvent(c)
	_, err = g.svc.Events.Insert(g.calendarID, ev).Do()
	if err != nil {
		var apiErr *googleapi.Error
		if errors.As(err, &apiErr) && apiErr.Code == 409 {
			return true, nil
		}
		return false, fmt.Errorf("イベント登録に失敗 (checkin %s): %w", c.ID, err)
	}
	return false, nil
}

// checkinToEvent はチェックインを時刻付き短時間イベントに変換する。
// イベント ID をチェックイン ID から決定的に生成することで再実行時の冪等性を担保する。
// Google のイベント ID は base32hex (`[a-v0-9]`) のみ許可されるため、その範囲内の
// 接頭辞 "fsq" を付ける (チェックイン ID は hex なのでそのまま使える)。
func (g *GCalClient) checkinToEvent(c Checkin) *calendar.Event {
	loc := time.FixedZone("checkin", c.TimeZoneOffset*60)
	start := time.Unix(c.CreatedAt, 0).In(loc)
	end := start.Add(g.eventDuration)

	return &calendar.Event{
		Id:          "fsq" + c.ID,
		Summary:     g.summary(c),
		Location:    g.location(c),
		Description: g.description(c),
		Start:       &calendar.EventDateTime{DateTime: start.Format(time.RFC3339)},
		End:         &calendar.EventDateTime{DateTime: end.Format(time.RFC3339)},
	}
}

func (g *GCalClient) summary(c Checkin) string {
	name := c.Venue.Name
	if name == "" {
		name = "チェックイン"
	}
	return name
}

func (g *GCalClient) location(c Checkin) string {
	if addr := strings.Join(c.Venue.Location.FormattedAddress, ", "); addr != "" {
		return addr
	}
	if c.Venue.Location.Address != "" {
		return c.Venue.Location.Address
	}
	if c.Venue.Location.Lat != 0 || c.Venue.Location.Lng != 0 {
		return fmt.Sprintf("%g,%g", c.Venue.Location.Lat, c.Venue.Location.Lng)
	}
	return ""
}

func (g *GCalClient) description(c Checkin) string {
	var lines []string
	if c.Shout != "" {
		lines = append(lines, c.Shout)
	}
	if cat := primaryCategory(c); cat != "" {
		lines = append(lines, "カテゴリ: "+cat)
	}
	lines = append(lines, "https://www.swarmapp.com/c/"+c.ID)
	return strings.Join(lines, "\n")
}

func primaryCategory(c Checkin) string {
	for _, cat := range c.Venue.Categories {
		if cat.Primary {
			return cat.Name
		}
	}
	if len(c.Venue.Categories) > 0 {
		return c.Venue.Categories[0].Name
	}
	return ""
}
