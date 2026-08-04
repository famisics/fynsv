// Package logging provides a JSON logger matching the misskey-mixi2-link bridge's log format.
package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

// New returns a *slog.Logger that writes one JSON object per line: error-level
// records go to stderr, everything else goes to stdout. The level value is
// lower-cased (slog defaults to upper-case level names).
func New() *slog.Logger {
	return slog.New(&splitHandler{
		out: newJSONHandler(os.Stdout),
		err: newJSONHandler(os.Stderr),
	})
}

func newJSONHandler(w *os.File) slog.Handler {
	return slog.NewJSONHandler(w, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.LevelKey {
				a.Value = slog.StringValue(strings.ToLower(a.Value.String()))
			}
			return a
		},
	})
}

// splitHandler routes error-level records to a stderr handler and everything
// else to a stdout handler.
type splitHandler struct {
	out slog.Handler
	err slog.Handler
}

func (h *splitHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.out.Enabled(ctx, level) || h.err.Enabled(ctx, level)
}

func (h *splitHandler) Handle(ctx context.Context, record slog.Record) error {
	if record.Level >= slog.LevelError {
		return h.err.Handle(ctx, record)
	}
	return h.out.Handle(ctx, record)
}

func (h *splitHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &splitHandler{out: h.out.WithAttrs(attrs), err: h.err.WithAttrs(attrs)}
}

func (h *splitHandler) WithGroup(name string) slog.Handler {
	return &splitHandler{out: h.out.WithGroup(name), err: h.err.WithGroup(name)}
}
