// Package mixi2 wraps the mixi2 Application SDK for the bridge's needs:
// posting, image upload, and the mentioned-post event stream.
package mixi2

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/mixigroup/mixi2-application-sdk-go/auth"
	constv1 "github.com/mixigroup/mixi2-application-sdk-go/gen/go/social/mixi/application/const/v1"
	modelv1 "github.com/mixigroup/mixi2-application-sdk-go/gen/go/social/mixi/application/model/v1"
	apiv1 "github.com/mixigroup/mixi2-application-sdk-go/gen/go/social/mixi/application/service/application_api/v1"
	streamv1 "github.com/mixigroup/mixi2-application-sdk-go/gen/go/social/mixi/application/service/application_stream/v1"
	"github.com/mixigroup/mixi2-application-sdk-go/event/stream"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

const (
	tokenURL      = "https://application-auth.mixi.social/oauth2/token"
	apiAddress    = "application-api.mixi.social:443"
	streamAddress = "application-stream.mixi.social:443"

	mediaPollInterval = time.Second
	mediaPollTimeout  = 60 * time.Second

	// reconnectDelay mirrors the TS Mixi2Watcher's RECONNECT_DELAY_MS: the
	// SDK's own EventWatcher.Watch only retries 3 times internally, so this
	// outer loop keeps the process from going silently idle after that.
	reconnectDelay = 15 * time.Second
)

// PostCreatedEvent is re-exported so callers don't need to import the SDK's
// generated package directly.
type PostCreatedEvent = modelv1.PostCreatedEvent

// Client wraps the mixi2 gRPC clients needed to post, upload media, and
// watch for mentioned-post events.
type Client struct {
	authenticator auth.Authenticator
	apiConn       *grpc.ClientConn
	streamConn    *grpc.ClientConn
	api           apiv1.ApplicationServiceClient
	streamClient  streamv1.ApplicationServiceClient
	httpClient    *http.Client
	logger        *slog.Logger
}

// NewClient authenticates with clientID/clientSecret and dials both the
// mixi2 API and stream gRPC endpoints.
func NewClient(clientID, clientSecret string, logger *slog.Logger) (*Client, error) {
	if logger == nil {
		logger = slog.Default()
	}
	authenticator, err := auth.NewAuthenticator(clientID, clientSecret, tokenURL)
	if err != nil {
		return nil, fmt.Errorf("mixi2 authenticate: %w", err)
	}

	creds := credentials.NewClientTLSFromCert(nil, "")
	apiConn, err := grpc.NewClient(apiAddress, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, fmt.Errorf("mixi2 dial api: %w", err)
	}
	streamConn, err := grpc.NewClient(streamAddress, grpc.WithTransportCredentials(creds))
	if err != nil {
		apiConn.Close()
		return nil, fmt.Errorf("mixi2 dial stream: %w", err)
	}

	return &Client{
		authenticator: authenticator,
		apiConn:       apiConn,
		streamConn:    streamConn,
		api:           apiv1.NewApplicationServiceClient(apiConn),
		streamClient:  streamv1.NewApplicationServiceClient(streamConn),
		httpClient:    http.DefaultClient,
		logger:        logger,
	}, nil
}

// Close releases the underlying gRPC connections.
func (c *Client) Close() error {
	err1 := c.apiConn.Close()
	err2 := c.streamConn.Close()
	if err1 != nil {
		return err1
	}
	return err2
}

func (c *Client) authorizedContext(ctx context.Context) (context.Context, error) {
	return c.authenticator.AuthorizedContext(ctx)
}

// CreatePost creates a mixi2 post with the given text and (optionally)
// attached media IDs, returning the created post's ID.
func (c *Client) CreatePost(text string, mediaIDList []string) (string, error) {
	ctx, err := c.authorizedContext(context.Background())
	if err != nil {
		return "", err
	}
	req := &apiv1.CreatePostRequest{Text: text}
	if len(mediaIDList) > 0 {
		req.MediaIdList = mediaIDList
	}
	res, err := c.api.CreatePost(ctx, req)
	if err != nil {
		return "", err
	}
	return res.GetPost().GetPostId(), nil
}

// UploadImage uploads data as an image attachment and waits for processing
// to complete, returning the resulting media ID.
func (c *Client) UploadImage(data []byte, contentType string) (string, error) {
	ctx, err := c.authorizedContext(context.Background())
	if err != nil {
		return "", err
	}
	initRes, err := c.api.InitiatePostMediaUpload(ctx, &apiv1.InitiatePostMediaUploadRequest{
		ContentType: contentType,
		DataSize:    uint64(len(data)),
		MediaType:   apiv1.InitiatePostMediaUploadRequest_TYPE_IMAGE,
	})
	if err != nil {
		return "", err
	}

	if err := c.uploadToURL(initRes.GetUploadUrl(), data); err != nil {
		return "", err
	}

	return c.waitForMediaReady(initRes.GetMediaId())
}

func (c *Client) uploadToURL(uploadURL string, data []byte) error {
	token, err := c.authenticator.GetAccessToken(context.Background())
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, uploadURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/octet-stream")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("media upload failed (%d): %s", res.StatusCode, string(body))
	}
	return nil
}

func (c *Client) waitForMediaReady(mediaID string) (string, error) {
	deadline := time.Now().Add(mediaPollTimeout)
	for time.Now().Before(deadline) {
		ctx, err := c.authorizedContext(context.Background())
		if err != nil {
			return "", err
		}
		res, err := c.api.GetPostMediaStatus(ctx, &apiv1.GetPostMediaStatusRequest{MediaId: mediaID})
		if err != nil {
			return "", err
		}
		switch res.GetStatus() {
		case apiv1.GetPostMediaStatusResponse_STATUS_COMPLETED:
			return mediaID, nil
		case apiv1.GetPostMediaStatusResponse_STATUS_FAILED:
			return "", fmt.Errorf("media upload failed: %s", mediaID)
		}
		time.Sleep(mediaPollInterval)
	}
	return "", fmt.Errorf("media upload timed out after %s: %s", mediaPollTimeout, mediaID)
}

// eventHandler adapts a plain callback to the SDK's event.EventHandler
// interface, extracting only mentioned-post events.
type eventHandler struct {
	onMentionedPost func(*PostCreatedEvent) error
}

func (h *eventHandler) Handle(ctx context.Context, ev *modelv1.Event) error {
	postCreated := ev.GetPostCreatedEvent()
	if postCreated == nil {
		return nil
	}
	mentioned := false
	for _, reason := range postCreated.GetEventReasonList() {
		if reason == constv1.EventReason_EVENT_REASON_POST_MENTIONED {
			mentioned = true
			break
		}
	}
	if !mentioned {
		return nil
	}
	return h.onMentionedPost(postCreated)
}

// Watch subscribes to the mixi2 event stream and calls onMentionedPost for
// each POST_MENTIONED post-created event, serially and in delivery order.
// It blocks until ctx is cancelled, reconnecting on failure.
func (c *Client) Watch(ctx context.Context, onMentionedPost func(*PostCreatedEvent) error, logger *slog.Logger) {
	if logger == nil {
		logger = c.logger
	}

	queue := make(chan *PostCreatedEvent, 64)
	go func() {
		for ev := range queue {
			if err := onMentionedPost(ev); err != nil {
				logger.Error("mixi2 mention handler failed", "postId", ev.GetPost().GetPostId(), "error", err.Error())
			}
		}
	}()

	handler := &eventHandler{onMentionedPost: func(ev *PostCreatedEvent) error {
		queue <- ev
		return nil
	}}
	watcher := stream.NewStreamWatcher(c.streamClient, c.authenticator, stream.WithLogger(logger))

	for {
		if ctx.Err() != nil {
			return
		}
		logger.Info("mixi2 stream connecting")
		if err := watcher.Watch(ctx, handler); err != nil && ctx.Err() == nil {
			logger.Error("mixi2 stream failed", "error", err.Error())
		}
		if ctx.Err() != nil {
			return
		}
		logger.Warn("mixi2 stream ended, reconnecting", "delayMs", reconnectDelay.Milliseconds())
		select {
		case <-ctx.Done():
			return
		case <-time.After(reconnectDelay):
		}
	}
}
