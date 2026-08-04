// Package config loads the bridge's configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config is the bridge's fully-resolved configuration.
type Config struct {
	MisskeyOrigin       string
	MisskeyPublicOrigin string
	MisskeyUserID       string // account owner's screen name; resolved to a user ID at startup
	MisskeyUserToken    string
	MisskeyBotToken     string
	MisskeyBotMention   string // e.g. "@uiroid"; only notes mentioning this are forwarded
	Mixi2ClientID       string
	Mixi2ClientSecret   string
	Mixi2BotMention     string // e.g. "@linkbot"
	Mixi2UserID         string // account owner's mixi2 screen name, used to validate the mention source
	TursoDatabaseURL    string
	TursoAuthToken      string // empty for local file: URLs
	DryRun              bool
}

var required = []string{
	"MISSKEY_ORIGIN",
	"MISSKEY_PUBLIC_ORIGIN",
	"MISSKEY_USER_ID",
	"MISSKEY_USER_TOKEN",
	"MISSKEY_BOT_TOKEN",
	"MISSKEY_BOT_ID",
	"MIXI2_CLIENT_ID",
	"MIXI2_CLIENT_SECRET",
	"MIXI2_BOT_ID",
	"MIXI2_USER_ID",
	"TURSO_DATABASE_URL",
}

// Load reads Config from environment variables, returning an error listing
// any missing required variables.
func Load() (Config, error) {
	var missing []string
	for _, key := range required {
		if os.Getenv(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing environment variables: %s", strings.Join(missing, ", "))
	}

	return Config{
		MisskeyOrigin:       strings.TrimSuffix(os.Getenv("MISSKEY_ORIGIN"), "/"),
		MisskeyPublicOrigin: strings.TrimSuffix(os.Getenv("MISSKEY_PUBLIC_ORIGIN"), "/"),
		MisskeyUserID:       os.Getenv("MISSKEY_USER_ID"),
		MisskeyUserToken:    os.Getenv("MISSKEY_USER_TOKEN"),
		MisskeyBotToken:     os.Getenv("MISSKEY_BOT_TOKEN"),
		MisskeyBotMention:   "@" + strings.TrimPrefix(os.Getenv("MISSKEY_BOT_ID"), "@"),
		Mixi2ClientID:       os.Getenv("MIXI2_CLIENT_ID"),
		Mixi2ClientSecret:   os.Getenv("MIXI2_CLIENT_SECRET"),
		Mixi2BotMention:     "@" + strings.TrimPrefix(os.Getenv("MIXI2_BOT_ID"), "@"),
		Mixi2UserID:         strings.TrimPrefix(os.Getenv("MIXI2_USER_ID"), "@"),
		TursoDatabaseURL:    os.Getenv("TURSO_DATABASE_URL"),
		TursoAuthToken:      os.Getenv("TURSO_AUTH_TOKEN"),
		DryRun:              os.Getenv("DRY_RUN") == "1",
	}, nil
}
