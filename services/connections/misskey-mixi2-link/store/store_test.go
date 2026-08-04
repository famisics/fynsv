package store

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	s, err := Open(db)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return s
}

func TestRecordThenIsProcessed(t *testing.T) {
	s := newTestStore(t)
	if processed, err := s.IsProcessed("misskey->mixi2", "n1"); err != nil || processed {
		t.Fatalf("expected not processed, got processed=%v err=%v", processed, err)
	}
	if err := s.Record("misskey->mixi2", "n1", "p1"); err != nil {
		t.Fatalf("record: %v", err)
	}
	if processed, err := s.IsProcessed("misskey->mixi2", "n1"); err != nil || !processed {
		t.Fatalf("expected processed, got processed=%v err=%v", processed, err)
	}
}

func TestDirectionIsPartOfIdentity(t *testing.T) {
	s := newTestStore(t)
	if err := s.Record("misskey->mixi2", "id1", "t1"); err != nil {
		t.Fatalf("record: %v", err)
	}
	if processed, err := s.IsProcessed("mixi2->misskey", "id1"); err != nil || processed {
		t.Fatalf("expected not processed for other direction, got processed=%v err=%v", processed, err)
	}
}

func TestDuplicateRecordDoesNotError(t *testing.T) {
	s := newTestStore(t)
	if err := s.Record("misskey->mixi2", "n1", "p1"); err != nil {
		t.Fatalf("first record: %v", err)
	}
	if err := s.Record("misskey->mixi2", "n1", "p2"); err != nil {
		t.Fatalf("duplicate record should not error: %v", err)
	}
}

func TestCursorSetAndOverwrite(t *testing.T) {
	s := newTestStore(t)
	if v, err := s.GetCursor("misskey_last_note_id"); err != nil || v != nil {
		t.Fatalf("expected nil cursor, got v=%v err=%v", v, err)
	}
	if err := s.SetCursor("misskey_last_note_id", "a"); err != nil {
		t.Fatalf("set cursor a: %v", err)
	}
	if err := s.SetCursor("misskey_last_note_id", "b"); err != nil {
		t.Fatalf("set cursor b: %v", err)
	}
	v, err := s.GetCursor("misskey_last_note_id")
	if err != nil {
		t.Fatalf("get cursor: %v", err)
	}
	if v == nil || *v != "b" {
		t.Fatalf("expected cursor \"b\", got %v", v)
	}
}
