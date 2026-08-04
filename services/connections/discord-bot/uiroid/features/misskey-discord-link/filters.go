package misskeydiscordlink

import (
	"strings"

	sharedmisskey "github.com/famisics/fynsv/services/connections/shared/misskey"
)

// normalizeHashtag lowercases hashtag and strips a leading '#', matching how
// Misskey normalizes tags in Note.Tags.
func normalizeHashtag(hashtag string) string {
	return strings.ToLower(strings.TrimPrefix(hashtag, "#"))
}

func hasTag(tags []string, hashtag string) bool {
	for _, t := range tags {
		if strings.ToLower(t) == hashtag {
			return true
		}
	}
	return false
}

// ShouldForwardNote reports whether note should be forwarded to Discord: it
// must be the account owner's own public note, not a reply or renote,
// without a content warning, and must carry the configured hashtag.
func ShouldForwardNote(note sharedmisskey.Note, selfUserID, hashtag string) bool {
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
	if hashtag == "" {
		return false
	}
	return hasTag(note.Tags, normalizeHashtag(hashtag))
}
