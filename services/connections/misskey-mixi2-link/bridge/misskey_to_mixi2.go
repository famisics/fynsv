package bridge

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/mixi2"
	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/store"
	sharedmisskey "github.com/famisics/fynsv/services/connections/shared/misskey"
	"github.com/famisics/fynsv/services/connections/shared/retry"
)

const (
	misskeyToMixi2Direction store.Direction = "misskey->mixi2"
	misskeyCursorKey                        = "misskey_last_note_id"
	mixi2MaxMedia                           = 4
)

// MisskeyToMixi2Deps are the collaborators MisskeyToMixi2 needs.
type MisskeyToMixi2Deps struct {
	Store               *store.Store
	Misskey             *sharedmisskey.Client
	Mixi2               *mixi2.Client
	MisskeyUserID       string
	MisskeyBotMention   string // e.g. "@uiroid"; only notes mentioning this are forwarded
	MisskeyPublicOrigin string
	DryRun              bool
	Logger              *slog.Logger
}

// MisskeyToMixi2 forwards the account owner's own public Misskey notes that
// mention the bot to mixi2.
type MisskeyToMixi2 struct {
	deps MisskeyToMixi2Deps
}

// NewMisskeyToMixi2 returns a MisskeyToMixi2 with the given dependencies.
func NewMisskeyToMixi2(deps MisskeyToMixi2Deps) *MisskeyToMixi2 {
	return &MisskeyToMixi2{deps: deps}
}

// Backfill catches up on notes missed since the last recorded cursor. On the
// very first run (no cursor yet) it seeds the cursor to the current latest
// note instead of forwarding history; under DryRun it does nothing.
func (b *MisskeyToMixi2) Backfill() error {
	cursor, err := b.deps.Store.GetCursor(misskeyCursorKey)
	if err != nil {
		return err
	}
	if cursor == nil {
		if b.deps.DryRun {
			return nil
		}
		latest, err := b.deps.Misskey.FetchLatestNote(b.deps.MisskeyUserID)
		if err != nil {
			return err
		}
		var loggedID any
		if latest != nil {
			if err := b.deps.Store.SetCursor(misskeyCursorKey, latest.ID); err != nil {
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

// HandleNote processes a single Misskey note, forwarding it to mixi2 if it
// qualifies. The cursor always advances (except under DryRun), even when the
// note is filtered out or forwarding fails.
func (b *MisskeyToMixi2) HandleNote(note sharedmisskey.Note) error {
	processed, err := b.deps.Store.IsProcessed(misskeyToMixi2Direction, note.ID)
	if err != nil {
		return err
	}
	if processed || !ShouldForwardNote(convertNote(note), b.deps.MisskeyUserID, b.deps.MisskeyBotMention) {
		return b.advanceCursor(note.ID)
	}

	images := ImageFiles(convertNote(note))
	body := StripMention(derefOr(note.Text, ""), b.deps.MisskeyBotMention)
	if body == "" && len(images) == 0 {
		return b.advanceCursor(note.ID)
	}
	if len(images) > mixi2MaxMedia {
		b.deps.Logger.Warn("too many images, extra ones dropped",
			"noteId", note.ID, "dropped", len(images)-mixi2MaxMedia)
	}
	noteURL := b.deps.MisskeyPublicOrigin + "/notes/" + note.ID
	text := FormatForMixi2(body, noteURL, 0)

	if b.deps.DryRun {
		b.deps.Logger.Info("[dry-run] would post to mixi2",
			"noteId", note.ID, "text", text, "images", len(images))
		return nil
	}

	if err := b.forward(note, images, text); err != nil {
		b.deps.Logger.Error("forward misskey -> mixi2 failed, skipped",
			"noteId", note.ID, "error", err.Error())
	}
	return b.advanceCursor(note.ID)
}

func (b *MisskeyToMixi2) forward(note sharedmisskey.Note, images []ImageFile, text string) error {
	if len(images) > mixi2MaxMedia {
		images = images[:mixi2MaxMedia]
	}
	mediaIDs := make([]string, 0, len(images))
	for _, image := range images {
		mediaID, err := retry.DoDefault(func() (string, error) {
			res, err := http.Get(image.URL)
			if err != nil {
				return "", err
			}
			defer res.Body.Close()
			if res.StatusCode < 200 || res.StatusCode >= 300 {
				return "", fmt.Errorf("image fetch failed: %d", res.StatusCode)
			}
			data, err := io.ReadAll(res.Body)
			if err != nil {
				return "", err
			}
			return b.deps.Mixi2.UploadImage(data, image.Type)
		})
		if err != nil {
			return err
		}
		mediaIDs = append(mediaIDs, mediaID)
	}

	postID, err := retry.DoDefault(func() (string, error) {
		return b.deps.Mixi2.CreatePost(text, mediaIDs)
	})
	if err != nil {
		return err
	}
	if err := b.deps.Store.Record(misskeyToMixi2Direction, note.ID, postID); err != nil {
		return err
	}
	b.deps.Logger.Info("forwarded misskey -> mixi2", "noteId", note.ID, "postId", postID)
	return nil
}

func (b *MisskeyToMixi2) advanceCursor(noteID string) error {
	if b.deps.DryRun {
		return nil
	}
	current, err := b.deps.Store.GetCursor(misskeyCursorKey)
	if err != nil {
		return err
	}
	if current == nil || *current < noteID {
		return b.deps.Store.SetCursor(misskeyCursorKey, noteID)
	}
	return nil
}

func convertNote(n sharedmisskey.Note) MisskeyNote {
	files := make([]MisskeyFile, len(n.Files))
	for i, f := range n.Files {
		files[i] = MisskeyFile{Type: f.Type, URL: f.URL}
	}
	return MisskeyNote{
		ID:         n.ID,
		UserID:     n.UserID,
		Text:       n.Text,
		CW:         n.CW,
		ReplyID:    n.ReplyID,
		RenoteID:   n.RenoteID,
		Visibility: n.Visibility,
		Files:      files,
	}
}

func derefOr(s *string, def string) string {
	if s == nil {
		return def
	}
	return *s
}
