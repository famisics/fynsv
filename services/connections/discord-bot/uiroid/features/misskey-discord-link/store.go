// Package misskeydiscordlink forwards the account owner's own hashtagged
// Misskey notes to a Discord channel configured via slash command.
package misskeydiscordlink

import "database/sql"

const (
	settingsKeyHashtag   = "hashtag"
	settingsKeyChannelID = "channel_id"
	cursorKeyLastNoteID  = "misskey_last_note_id"
)

// Store persists uiroid's misskey-discord-link settings, forwarding cursor,
// and dedup records in a local SQLite database.
type Store struct {
	db *sql.DB
}

// Open runs the schema DDL against db and returns a Store. The caller owns db
// and is responsible for closing it.
func Open(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS cursors (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS forwarded_notes (
		note_id TEXT PRIMARY KEY
	)`); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) getSetting(key string) (string, error) {
	row := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key)
	var value string
	err := row.Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

func (s *Store) setSetting(key, value string) error {
	_, err := s.db.Exec(
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		key, value,
	)
	return err
}

// Hashtag returns the configured hashtag (without leading '#'), or "" if unset.
func (s *Store) Hashtag() (string, error) {
	return s.getSetting(settingsKeyHashtag)
}

// SetHashtag stores the hashtag to watch for (without leading '#').
func (s *Store) SetHashtag(hashtag string) error {
	return s.setSetting(settingsKeyHashtag, hashtag)
}

// ChannelID returns the configured forward-destination Discord channel ID, or
// "" if unset.
func (s *Store) ChannelID() (string, error) {
	return s.getSetting(settingsKeyChannelID)
}

// SetChannelID stores the forward-destination Discord channel ID.
func (s *Store) SetChannelID(channelID string) error {
	return s.setSetting(settingsKeyChannelID, channelID)
}

// GetCursor returns the last-processed Misskey note ID, or nil if unset.
func (s *Store) GetCursor() (*string, error) {
	row := s.db.QueryRow("SELECT value FROM cursors WHERE key = ?", cursorKeyLastNoteID)
	var value string
	err := row.Scan(&value)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// SetCursor upserts the last-processed Misskey note ID.
func (s *Store) SetCursor(noteID string) error {
	_, err := s.db.Exec(
		"INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		cursorKeyLastNoteID, noteID,
	)
	return err
}

// IsForwarded reports whether noteID has already been forwarded to Discord.
func (s *Store) IsForwarded(noteID string) (bool, error) {
	row := s.db.QueryRow("SELECT 1 FROM forwarded_notes WHERE note_id = ?", noteID)
	var dummy int
	err := row.Scan(&dummy)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// MarkForwarded records noteID as forwarded, silently ignoring a duplicate.
func (s *Store) MarkForwarded(noteID string) error {
	_, err := s.db.Exec("INSERT OR IGNORE INTO forwarded_notes (note_id) VALUES (?)", noteID)
	return err
}
