package misskeydiscordlink

import (
	"log/slog"
	"strings"

	"github.com/bwmarrin/discordgo"

	sharedmisskey "github.com/famisics/fynsv/services/connections/shared/misskey"
)

// BridgeDeps are the collaborators Bridge needs.
type BridgeDeps struct {
	Store               *Store
	Misskey             *sharedmisskey.Client
	Discord             *discordgo.Session
	MisskeyUserID       string
	MisskeyPublicOrigin string
	Logger              *slog.Logger
}

// Bridge forwards the account owner's own hashtagged Misskey notes to the
// Discord channel configured via slash command.
type Bridge struct {
	deps BridgeDeps
}

// NewBridge returns a Bridge with the given dependencies.
func NewBridge(deps BridgeDeps) *Bridge {
	return &Bridge{deps: deps}
}

// Backfill catches up on notes missed since the last recorded cursor. On the
// very first run (no cursor yet) it seeds the cursor to the current latest
// note instead of forwarding history.
func (b *Bridge) Backfill() error {
	cursor, err := b.deps.Store.GetCursor()
	if err != nil {
		return err
	}
	if cursor == nil {
		latest, err := b.deps.Misskey.FetchLatestNote(b.deps.MisskeyUserID)
		if err != nil {
			return err
		}
		var loggedID any
		if latest != nil {
			if err := b.deps.Store.SetCursor(latest.ID); err != nil {
				return err
			}
			loggedID = latest.ID
		}
		b.deps.Logger.Info("misskey cursor initialized", "noteId", loggedID)
		return nil
	}

	notes, err := b.deps.Misskey.FetchUserNotes(b.deps.MisskeyUserID, *cursor)
	if err != nil {
		return err
	}
	if len(notes) > 0 {
		b.deps.Logger.Info("misskey backfill", "count", len(notes))
	}
	for _, note := range notes {
		if err := b.HandleNote(note); err != nil {
			return err
		}
	}
	return nil
}

// HandleNote processes a single Misskey note, forwarding it to Discord if it
// qualifies. The cursor always advances, even when the note is filtered out,
// unconfigured, or forwarding fails.
func (b *Bridge) HandleNote(note sharedmisskey.Note) error {
	forwarded, err := b.deps.Store.IsForwarded(note.ID)
	if err != nil {
		return err
	}
	if forwarded {
		return b.advanceCursor(note.ID)
	}

	hashtag, err := b.deps.Store.Hashtag()
	if err != nil {
		return err
	}
	if !ShouldForwardNote(note, b.deps.MisskeyUserID, hashtag) {
		return b.advanceCursor(note.ID)
	}

	channelID, err := b.deps.Store.ChannelID()
	if err != nil {
		return err
	}
	if channelID == "" {
		b.deps.Logger.Warn("forward channel not configured, skipping note", "noteId", note.ID)
		return b.advanceCursor(note.ID)
	}

	if err := b.forward(channelID, note); err != nil {
		b.deps.Logger.Error("forward misskey note to discord failed, skipped",
			"noteId", note.ID, "error", err.Error())
	}
	return b.advanceCursor(note.ID)
}

func (b *Bridge) forward(channelID string, note sharedmisskey.Note) error {
	message := formatMessage(note, b.deps.MisskeyPublicOrigin)
	if _, err := b.deps.Discord.ChannelMessageSend(channelID, message); err != nil {
		return err
	}
	if err := b.deps.Store.MarkForwarded(note.ID); err != nil {
		return err
	}
	b.deps.Logger.Info("forwarded misskey note to discord", "noteId", note.ID, "channelId", channelID)
	return nil
}

func formatMessage(note sharedmisskey.Note, publicOrigin string) string {
	var body string
	if note.Text != nil {
		body = *note.Text
	}
	noteURL := publicOrigin + "/notes/" + note.ID

	var lines []string
	if body != "" {
		lines = append(lines, body)
	}
	for _, f := range note.Files {
		if f.URL != nil && strings.HasPrefix(f.Type, "image/") {
			lines = append(lines, *f.URL)
		}
	}
	lines = append(lines, noteURL)
	return strings.Join(lines, "\n")
}

func (b *Bridge) advanceCursor(noteID string) error {
	current, err := b.deps.Store.GetCursor()
	if err != nil {
		return err
	}
	if current == nil || *current < noteID {
		return b.deps.Store.SetCursor(noteID)
	}
	return nil
}
