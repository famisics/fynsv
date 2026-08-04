package bridge

import (
	"regexp"
	"strings"
	"unicode"
)

// MixI2MaxPostLength is the mixi2 post character limit, counted in code points.
const MixI2MaxPostLength = 149

var collapseSpaceTabs = regexp.MustCompile(`[ \t]{2,}`)

// FormatForMixi2 fits text within maxLength code points, truncating and
// appending an ellipsis plus the note URL when it doesn't fit.
func FormatForMixi2(text string, noteURL string, maxLength int) string {
	if maxLength <= 0 {
		maxLength = MixI2MaxPostLength
	}
	chars := []rune(text)
	if len(chars) <= maxLength {
		return text
	}
	budget := maxLength - len([]rune(noteURL)) - 2 // "…" + newline
	if budget < 0 {
		budget = 0
	}
	truncated := strings.TrimRightFunc(string(chars[:budget]), unicode.IsSpace)
	return truncated + "…\n" + noteURL
}

// mentionOccurrences returns the start indices (in rune space) of mention as
// a whitespace-delimited token within text: the run of runes must be preceded
// by the start of text or whitespace, and followed by the end of text or
// whitespace. Matches are non-overlapping and scanned left to right; on a
// successful match, scanning resumes right after the mention (the boundary
// whitespace is left untouched, mirroring a non-consuming lookahead).
func mentionOccurrences(text []rune, mention []rune) []int {
	n := len(mention)
	if n == 0 || n > len(text) {
		return nil
	}
	var occurrences []int
	i := 0
	for i+n <= len(text) {
		if runesEqual(text[i:i+n], mention) {
			leftOK := i == 0 || unicode.IsSpace(text[i-1])
			rightOK := i+n == len(text) || unicode.IsSpace(text[i+n])
			if leftOK && rightOK {
				occurrences = append(occurrences, i)
				i += n
				continue
			}
		}
		i++
	}
	return occurrences
}

func runesEqual(a, b []rune) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// HasMention reports whether text contains mention as a whitespace-delimited
// token (e.g. "@linkbot" does not match inside "@linkbot2").
func HasMention(text string, mention string) bool {
	return len(mentionOccurrences([]rune(text), []rune(mention))) > 0
}

// StripMention removes mention from text wherever it appears as a
// whitespace-delimited token, collapses runs of 2+ ASCII spaces/tabs left
// behind, and trims the result.
func StripMention(text string, mention string) string {
	runes := []rune(text)
	mentionRunes := []rune(mention)
	occurrences := mentionOccurrences(runes, mentionRunes)

	var b strings.Builder
	last := 0
	for _, start := range occurrences {
		b.WriteString(string(runes[last:start]))
		last = start + len(mentionRunes)
	}
	b.WriteString(string(runes[last:]))

	result := collapseSpaceTabs.ReplaceAllString(b.String(), " ")
	return strings.TrimFunc(result, unicode.IsSpace)
}
