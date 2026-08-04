// Package retry provides a simple exponential-backoff retry helper.
package retry

import "time"

const (
	defaultAttempts    = 3
	defaultBaseDelayMs = 2000
)

// Do retries fn up to attempts times with exponential backoff
// (baseDelayMs * 2^i between attempts), returning the last error if all
// attempts fail.
func Do[T any](fn func() (T, error), attempts int, baseDelayMs int) (T, error) {
	if attempts <= 0 {
		attempts = defaultAttempts
	}
	if baseDelayMs <= 0 {
		baseDelayMs = defaultBaseDelayMs
	}
	var (
		result T
		err    error
	)
	for i := 0; i < attempts; i++ {
		result, err = fn()
		if err == nil {
			return result, nil
		}
		if i < attempts-1 {
			time.Sleep(time.Duration(baseDelayMs*(1<<i)) * time.Millisecond)
		}
	}
	return result, err
}

// DoDefault retries fn with the default 3 attempts / 2000ms base delay.
func DoDefault[T any](fn func() (T, error)) (T, error) {
	return Do(fn, defaultAttempts, defaultBaseDelayMs)
}
