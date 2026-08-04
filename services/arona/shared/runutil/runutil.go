// Package runutil provides small helpers shared by the arona-resident daemon services.
package runutil

import (
	"os"
	"os/signal"
	"syscall"
)

// WaitForSignal blocks until SIGINT or SIGTERM is received and returns it.
func WaitForSignal() os.Signal {
	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	return <-sc
}
