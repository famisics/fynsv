package bridge

import "strings"

// MisskeyFile is the subset of a Misskey drive file needed for filtering.
type MisskeyFile struct {
	Type string
	URL  *string
}

// MisskeyNote is the subset of a Misskey note needed for filtering/forwarding.
type MisskeyNote struct {
	ID         string
	UserID     string
	Text       *string
	CW         *string
	ReplyID    *string
	RenoteID   *string
	Visibility string
	Files      []MisskeyFile
}

// ImageFile is a note attachment known to be an image with a usable URL.
type ImageFile struct {
	Type string
	URL  string
}

// ImageFiles returns the note's attachments that have a URL and an image/*
// mime type.
func ImageFiles(note MisskeyNote) []ImageFile {
	var images []ImageFile
	for _, f := range note.Files {
		if f.URL != nil && strings.HasPrefix(f.Type, "image/") {
			images = append(images, ImageFile{Type: f.Type, URL: *f.URL})
		}
	}
	return images
}

// ShouldForwardNote reports whether note should be bridged to mixi2: it must
// be the account owner's own public note, not a reply or renote, without a
// content warning, and must mention the bot.
func ShouldForwardNote(note MisskeyNote, selfUserID string, mention string) bool {
	if note.UserID != selfUserID {
		return false
	}
	if note.ReplyID != nil {
		return false
	}
	if note.RenoteID != nil {
		return false
	}
	if note.Visibility != "public" {
		return false
	}
	if note.CW != nil {
		return false
	}
	if note.Text == nil || *note.Text == "" || !HasMention(*note.Text, mention) {
		return false
	}
	return true
}
