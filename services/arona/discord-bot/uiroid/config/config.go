// Package config loads uiroid's configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config is uiroid's fully-resolved configuration.
type Config struct {
	DiscordToken     string
	MisskeyOrigin    string
	MisskeyUserID    string // account owner's screen name; resolved to a user ID at startup
	MisskeyUserToken string
	DBPath           string
}

var required = []string{
	"DISCORD_TOKEN",
	"MISSKEY_ORIGIN",
	"MISSKEY_USER_ID",
	"MISSKEY_USER_TOKEN",
	"DB_PATH",
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
		DiscordToken:     os.Getenv("DISCORD_TOKEN"),
		MisskeyOrigin:    strings.TrimSuffix(os.Getenv("MISSKEY_ORIGIN"), "/"),
		MisskeyUserID:    os.Getenv("MISSKEY_USER_ID"),
		MisskeyUserToken: os.Getenv("MISSKEY_USER_TOKEN"),
		DBPath:           os.Getenv("DB_PATH"),
	}, nil
}
