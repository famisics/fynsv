package bridge

import (
	"strings"
	"testing"
)

const testURL = "https://misskey.example.com/notes/abcdef123"

func TestFormatForMixi2_UnderLimit(t *testing.T) {
	got := FormatForMixi2("こんにちは", testURL, 0)
	if got != "こんにちは" {
		t.Fatalf("got %q, want unchanged", got)
	}
}

func TestFormatForMixi2_ExactLimit(t *testing.T) {
	text := strings.Repeat("あ", MixI2MaxPostLength)
	got := FormatForMixi2(text, testURL, 0)
	if got != text {
		t.Fatalf("got %q, want unchanged text at exact limit", got)
	}
}

func TestFormatForMixi2_OverLimitTruncatesAndAppendsURL(t *testing.T) {
	text := strings.Repeat("あ", 200)
	got := FormatForMixi2(text, testURL, 0)
	if !strings.Contains(got, "…") {
		t.Fatalf("expected ellipsis in result, got %q", got)
	}
	if !strings.HasSuffix(got, testURL) {
		t.Fatalf("expected result to end with URL, got %q", got)
	}
	if len([]rune(got)) > MixI2MaxPostLength {
		t.Fatalf("result exceeds max length: %d runes", len([]rune(got)))
	}
}

func TestFormatForMixi2_CountsCodePointsNotUTF16Units(t *testing.T) {
	text := strings.Repeat("🎉", 200)
	got := FormatForMixi2(text, testURL, 0)
	if len([]rune(got)) > MixI2MaxPostLength {
		t.Fatalf("result exceeds max length: %d runes", len([]rune(got)))
	}
	if strings.Contains(got, "�") {
		t.Fatalf("result contains replacement character (broken surrogate pair): %q", got)
	}
}

func TestHasMention_True(t *testing.T) {
	cases := []string{
		"@uiroid です",
		"やあ @uiroid",
		"前 @uiroid 後",
		"@uiroid",
		"　@uiroid　です", // U+3000 全角スペース区切り
	}
	for _, text := range cases {
		if !HasMention(text, "@uiroid") {
			t.Errorf("HasMention(%q) = false, want true", text)
		}
	}
}

func TestHasMention_False(t *testing.T) {
	cases := []string{
		"こんにちは",
		"@uiroidbot です",
		"メール uiroid@example.com",
	}
	for _, text := range cases {
		if HasMention(text, "@uiroid") {
			t.Errorf("HasMention(%q) = true, want false", text)
		}
	}
}

func TestStripMention_TrailingMention(t *testing.T) {
	got := StripMention("今日はいい天気 @linkbot", "@linkbot")
	if got != "今日はいい天気" {
		t.Fatalf("got %q", got)
	}
}

func TestStripMention_LeadingMention(t *testing.T) {
	got := StripMention("@linkbot 今日はいい天気", "@linkbot")
	if got != "今日はいい天気" {
		t.Fatalf("got %q", got)
	}
}

func TestStripMention_MidMentionCollapsesSpace(t *testing.T) {
	got := StripMention("今日は @linkbot いい天気", "@linkbot")
	if got != "今日は いい天気" {
		t.Fatalf("got %q", got)
	}
}

func TestStripMention_MentionOnlyBecomesEmpty(t *testing.T) {
	got := StripMention("@linkbot", "@linkbot")
	if got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}

func TestStripMention_PartialMatchUntouched(t *testing.T) {
	got := StripMention("hi @linkbot2", "@linkbot")
	if got != "hi @linkbot2" {
		t.Fatalf("got %q", got)
	}
}

func TestStripMention_RepeatedMentionsAllRemoved(t *testing.T) {
	got := StripMention("@a @a hello", "@a")
	if got != "hello" {
		t.Fatalf("got %q, want %q", got, "hello")
	}
}

func TestStripMention_FullWidthSpaceBoundary(t *testing.T) {
	// U+3000 (全角スペース) is a valid mention boundary (unicode.IsSpace),
	// but unlike ASCII " \t" it is NOT collapsed by the TS regex
	// `[ \t]{2,}` — this mirrors that exact asymmetry, not a bug.
	got := StripMention("今日は　@linkbot　いい天気", "@linkbot")
	want := "今日は　　いい天気"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
