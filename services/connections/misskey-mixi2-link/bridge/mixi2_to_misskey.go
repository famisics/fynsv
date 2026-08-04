package bridge

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/mixi2"
	"github.com/famisics/fynsv/services/connections/misskey-mixi2-link/store"
	sharedmisskey "github.com/famisics/fynsv/services/connections/shared/misskey"
	"github.com/famisics/fynsv/services/connections/shared/retry"
)

const mixi2ToMisskeyDirection store.Direction = "mixi2->misskey"

// Mixi2ToMisskeyDeps are the collaborators Mixi2ToMisskey needs.
type Mixi2ToMisskeyDeps struct {
	Store      *store.Store
	MisskeyBot *sharedmisskey.Client
	OwnerName  string // account owner's mixi2 screen name (no "@"), matched against the event issuer
	BotMention string // bot mention text, e.g. "@linkbot"
	DryRun     bool
	Logger     *slog.Logger
}

// Mixi2ToMisskey forwards mixi2 posts that mention the bot, authored by the
// account owner, to Misskey.
type Mixi2ToMisskey struct {
	deps Mixi2ToMisskeyDeps
}

// NewMixi2ToMisskey returns a Mixi2ToMisskey with the given dependencies.
func NewMixi2ToMisskey(deps Mixi2ToMisskeyDeps) *Mixi2ToMisskey {
	return &Mixi2ToMisskey{deps: deps}
}

// HandleMentionedPost processes a single mixi2 POST_MENTIONED event. Unlike
// MisskeyToMixi2.HandleNote, this has no try/catch equivalent around the
// forward step: on failure it returns the error and relies on the caller
// (the stream handler) to log and move on. There is no cursor for this
// direction, so a failed forward is simply lost.
func (b *Mixi2ToMisskey) HandleMentionedPost(event *mixi2.PostCreatedEvent) error {
	post := event.GetPost()
	if post == nil || post.GetIsDeleted() {
		return nil
	}

	issuerName := event.GetIssuer().GetName()
	if issuerName != b.deps.OwnerName {
		var loggedIssuer any
		if issuerName != "" {
			loggedIssuer = issuerName
		}
		b.deps.Logger.Info("mention from non-owner ignored", "postId", post.GetPostId(), "issuer", loggedIssuer)
		return nil
	}

	processed, err := b.deps.Store.IsProcessed(mixi2ToMisskeyDirection, post.GetPostId())
	if err != nil {
		return err
	}
	if processed {
		return nil
	}

	text := StripMention(post.GetText(), b.deps.BotMention)
	var images []*mixi2Image
	for _, m := range post.GetPostMediaList() {
		if img := m.GetImage(); img != nil {
			images = append(images, &mixi2Image{
				URL:      img.GetLargeImageUrl(),
				MimeType: img.GetLargeImageMimeType(),
			})
		}
	}
	if text == "" && len(images) == 0 {
		return nil
	}

	if b.deps.DryRun {
		b.deps.Logger.Info("[dry-run] would post to misskey",
			"postId", post.GetPostId(), "text", text, "images", len(images))
		return nil
	}

	fileIDs := make([]string, 0, len(images))
	for i, image := range images {
		fileID, err := retry.DoDefault(func() (string, error) {
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
			ext := "jpg"
			if parts := strings.SplitN(image.MimeType, "/", 2); len(parts) == 2 && parts[1] != "" {
				ext = parts[1]
			}
			name := fmt.Sprintf("mixi2-%s-%d.%s", post.GetPostId(), i, ext)
			return b.deps.MisskeyBot.UploadToDrive(data, name, image.MimeType)
		})
		if err != nil {
			return err
		}
		fileIDs = append(fileIDs, fileID)
	}

	var notePtr *string
	if text != "" {
		notePtr = &text
	}
	note, err := retry.DoDefault(func() (*sharedmisskey.Note, error) {
		return b.deps.MisskeyBot.CreateNote(notePtr, fileIDs)
	})
	if err != nil {
		return err
	}
	if err := b.deps.Store.Record(mixi2ToMisskeyDirection, post.GetPostId(), note.ID); err != nil {
		return err
	}
	b.deps.Logger.Info("forwarded mixi2 -> misskey", "postId", post.GetPostId(), "noteId", note.ID)
	return nil
}

type mixi2Image struct {
	URL      string
	MimeType string
}
