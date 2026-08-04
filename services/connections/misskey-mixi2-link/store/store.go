// Package store persists bridge dedup records and per-direction cursors.
package store

import "database/sql"

// Direction identifies which way a post was bridged.
type Direction string

// Store wraps a *sql.DB with the bridge's dedup/cursor schema.
type Store struct {
	db *sql.DB
}

// Open runs the schema DDL against db and returns a Store. The caller owns db
// and is responsible for closing it.
func Open(db *sql.DB) (*Store, error) {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS bridged_posts (
		direction  TEXT NOT NULL,
		source_id  TEXT NOT NULL,
		target_id  TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		PRIMARY KEY (direction, source_id)
	)`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS cursors (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

// IsProcessed reports whether (direction, sourceID) has already been recorded.
func (s *Store) IsProcessed(direction Direction, sourceID string) (bool, error) {
	row := s.db.QueryRow(
		"SELECT 1 FROM bridged_posts WHERE direction = ? AND source_id = ?",
		string(direction), sourceID,
	)
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

// Record stores (direction, sourceID) -> targetID, silently ignoring a
// duplicate (direction, sourceID) pair rather than overwriting it.
func (s *Store) Record(direction Direction, sourceID, targetID string) error {
	_, err := s.db.Exec(
		"INSERT OR IGNORE INTO bridged_posts (direction, source_id, target_id) VALUES (?, ?, ?)",
		string(direction), sourceID, targetID,
	)
	return err
}

// GetCursor returns the stored value for key, or nil if unset.
func (s *Store) GetCursor(key string) (*string, error) {
	row := s.db.QueryRow("SELECT value FROM cursors WHERE key = ?", key)
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

// SetCursor upserts key -> value, overwriting any existing value.
func (s *Store) SetCursor(key, value string) error {
	_, err := s.db.Exec(
		"INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		key, value,
	)
	return err
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}
