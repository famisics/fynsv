package bridge

import "testing"

const (
	testSelf    = "user-self"
	testMention = "@uiroid"
)

func strPtr(s string) *string { return &s }

func baseNote(overrides func(*MisskeyNote)) MisskeyNote {
	n := MisskeyNote{
		ID:         "note1",
		UserID:     testSelf,
		Text:       strPtr("@uiroid hello"),
		Visibility: "public",
	}
	if overrides != nil {
		overrides(&n)
	}
	return n
}

func TestShouldForwardNote_Forwards(t *testing.T) {
	cases := []struct {
		name      string
		overrides func(*MisskeyNote)
	}{
		{"メンション付きの本人の公開テキストノート", nil},
		{"メンションのみのノート", func(n *MisskeyNote) { n.Text = strPtr("@uiroid") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			n := baseNote(tc.overrides)
			if !ShouldForwardNote(n, testSelf, testMention) {
				t.Errorf("expected forward=true for %q", tc.name)
			}
		})
	}
}

func TestShouldForwardNote_DoesNotForward(t *testing.T) {
	cases := []struct {
		name      string
		overrides func(*MisskeyNote)
	}{
		{"メンションなし", func(n *MisskeyNote) { n.Text = strPtr("hello") }},
		{"部分一致のメンション", func(n *MisskeyNote) { n.Text = strPtr("@uiroidbot hello") }},
		{"テキストなし (画像のみ)", func(n *MisskeyNote) {
			n.Text = nil
			n.Files = []MisskeyFile{{Type: "image/png", URL: strPtr("https://x/a.png")}}
		}},
		{"他人のノート", func(n *MisskeyNote) { n.UserID = "someone-else" }},
		{"リプライ", func(n *MisskeyNote) { n.ReplyID = strPtr("parent") }},
		{"リノート", func(n *MisskeyNote) { n.RenoteID = strPtr("orig"); n.Text = nil }},
		{"引用リノート", func(n *MisskeyNote) { n.RenoteID = strPtr("orig") }},
		{"ホーム限定", func(n *MisskeyNote) { n.Visibility = "home" }},
		{"フォロワー限定", func(n *MisskeyNote) { n.Visibility = "followers" }},
		{"ダイレクト", func(n *MisskeyNote) { n.Visibility = "specified" }},
		{"CW 付き", func(n *MisskeyNote) { n.CW = strPtr("注意") }},
		{"テキストも画像もない", func(n *MisskeyNote) { n.Text = nil }},
		{"テキストなしで非画像ファイルのみ", func(n *MisskeyNote) {
			n.Text = nil
			n.Files = []MisskeyFile{{Type: "video/mp4", URL: strPtr("https://x/a.mp4")}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			n := baseNote(tc.overrides)
			if ShouldForwardNote(n, testSelf, testMention) {
				t.Errorf("expected forward=false for %q", tc.name)
			}
		})
	}
}

func TestImageFiles_OnlyImagesWithURL(t *testing.T) {
	n := baseNote(func(n *MisskeyNote) {
		n.Files = []MisskeyFile{
			{Type: "image/jpeg", URL: strPtr("https://x/a.jpg")},
			{Type: "video/mp4", URL: strPtr("https://x/b.mp4")},
			{Type: "image/png", URL: nil},
		}
	})
	got := ImageFiles(n)
	want := []ImageFile{{Type: "image/jpeg", URL: "https://x/a.jpg"}}
	if len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("ImageFiles() = %+v, want %+v", got, want)
	}
}

func TestImageFiles_EmptyWhenNoFiles(t *testing.T) {
	n := baseNote(nil)
	got := ImageFiles(n)
	if len(got) != 0 {
		t.Fatalf("ImageFiles() = %+v, want empty", got)
	}
}
