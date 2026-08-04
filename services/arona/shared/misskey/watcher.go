package misskey

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const reconnectDelay = 3 * time.Second

// Watcher subscribes to a Misskey account's homeTimeline stream and invokes
// onNote for each of that account's own notes, strictly one at a time and in
// delivery order. A failing onNote is logged and does not stop the stream.
type Watcher struct {
	origin string
	token  string
	userID string
	onNote func(Note) error
	logger *slog.Logger

	mu      sync.Mutex
	conn    *websocket.Conn
	stopped bool
	queue   chan Note
}

// NewWatcher returns a Watcher for the given instance origin/token, filtering
// to notes authored by userID. logger may be nil, in which case slog.Default
// is used.
func NewWatcher(origin, token, userID string, onNote func(Note) error, logger *slog.Logger) *Watcher {
	if logger == nil {
		logger = slog.Default()
	}
	return &Watcher{
		origin: origin,
		token:  token,
		userID: userID,
		onNote: onNote,
		logger: logger,
		queue:  make(chan Note, 64),
	}
}

// Start connects to the stream and begins dispatching notes in the
// background. It returns immediately.
func (w *Watcher) Start() {
	go w.worker()
	go w.connectLoop()
}

// Stop closes the current connection and stops reconnecting. In-flight work
// is not drained.
func (w *Watcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopped = true
	if w.conn != nil {
		w.conn.Close()
	}
}

func (w *Watcher) isStopped() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stopped
}

func (w *Watcher) worker() {
	for note := range w.queue {
		if err := w.onNote(note); err != nil {
			w.logger.Error("misskey note handler failed", "noteId", note.ID, "error", err.Error())
		}
	}
}

func (w *Watcher) connectLoop() {
	for !w.isStopped() {
		if err := w.connectOnce(); err != nil {
			w.logger.Warn("misskey stream disconnected", "error", err.Error())
		}
		if w.isStopped() {
			return
		}
		time.Sleep(reconnectDelay)
	}
}

func (w *Watcher) connectOnce() error {
	wsOrigin := strings.NewReplacer("http://", "ws://", "https://", "wss://").Replace(w.origin)
	streamURL := fmt.Sprintf("%s/streaming?i=%s&_t=%d", wsOrigin, url.QueryEscape(w.token), time.Now().UnixMilli())

	conn, _, err := websocket.DefaultDialer.Dial(streamURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	w.mu.Lock()
	w.conn = conn
	w.mu.Unlock()

	w.logger.Info("misskey stream connected")

	const connID = "home"
	connectMsg := map[string]any{
		"type": "connect",
		"body": map[string]any{
			"channel": "homeTimeline",
			"id":      connID,
			"params":  map[string]any{"withRenotes": true},
		},
	}
	if err := conn.WriteJSON(connectMsg); err != nil {
		return err
	}

	for {
		var envelope struct {
			Type string          `json:"type"`
			Body json.RawMessage `json:"body"`
		}
		if err := conn.ReadJSON(&envelope); err != nil {
			return err
		}
		if envelope.Type != "channel" {
			continue
		}
		var channelMsg struct {
			ID   string          `json:"id"`
			Type string          `json:"type"`
			Body json.RawMessage `json:"body"`
		}
		if err := json.Unmarshal(envelope.Body, &channelMsg); err != nil {
			continue
		}
		if channelMsg.ID != connID || channelMsg.Type != "note" {
			continue
		}
		var note Note
		if err := json.Unmarshal(channelMsg.Body, &note); err != nil {
			continue
		}
		if note.UserID != w.userID {
			continue
		}
		if w.isStopped() {
			return nil
		}
		w.queue <- note
	}
}
