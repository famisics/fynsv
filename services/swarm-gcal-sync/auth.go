package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// runFoursquareAuth はローカルで Foursquare の OAuth code フローを実行し、
// 長期有効なユーザートークンを標準出力する。
// FOURSQUARE_CLIENT_ID / FOURSQUARE_CLIENT_SECRET を環境変数から読む。Foursquare アプリの
// 「Redirect URI」に http://127.0.0.1:8765/callback を登録しておくこと。
func runFoursquareAuth(ctx context.Context) error {
	clientID := mustEnv("FOURSQUARE_CLIENT_ID")
	clientSecret := mustEnv("FOURSQUARE_CLIENT_SECRET")

	const redirect = "http://127.0.0.1:8765/callback"
	state, err := randomState()
	if err != nil {
		return err
	}
	authURL := "https://foursquare.com/oauth2/authenticate?" + url.Values{
		"client_id":     {clientID},
		"response_type": {"code"},
		"redirect_uri":  {redirect},
		"state":         {state},
	}.Encode()

	code, err := listenForCode(ctx, ":8765", "/callback", authURL, state)
	if err != nil {
		return err
	}

	// 認証情報はクエリではなくボディで送る (URL 経由でのログ漏洩を避ける)。
	form := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirect},
		"code":          {code},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://foursquare.com/oauth2/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("リクエスト生成に失敗: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("foursquare トークン交換に失敗: %w", redactURL(err))
	}
	defer resp.Body.Close()

	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("foursquare トークンレスポンスのデコードに失敗: %w", err)
	}
	if body.AccessToken == "" {
		return fmt.Errorf("foursquare のアクセストークンが取得できませんでした (status %s)", resp.Status)
	}

	path := foursquareTokenPath()
	if err := saveFoursquareToken(path, body.AccessToken); err != nil {
		return err
	}
	fmt.Printf("Foursquare トークンを保存しました: %s\n", path)
	return nil
}

// listenForCode はローカルに HTTP サーバを立て、authURL をユーザーに案内し、
// リダイレクトで返ってくる ?code= を受け取る。CSRF 対策として state を検証する。
func listenForCode(ctx context.Context, addr, path, authURL, wantState string) (string, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", fmt.Errorf("ローカルリスナの起動に失敗 (%s): %w", addr, err)
	}
	defer ln.Close()

	codeCh := make(chan string, 1)
	mux := http.NewServeMux()
	mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("state") != wantState {
			http.Error(w, "state が一致しません", http.StatusBadRequest)
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "code がありません", http.StatusBadRequest)
			return
		}
		fmt.Fprintln(w, "認証が完了しました。ターミナルに戻ってください。")
		codeCh <- code
	})

	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	defer srv.Shutdown(context.Background())

	fmt.Println("ブラウザで次の URL を開いて認証してください:")
	fmt.Println(authURL)

	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(5 * time.Minute):
		return "", fmt.Errorf("認証がタイムアウトしました")
	case code := <-codeCh:
		return code, nil
	}
}

func randomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("state の生成に失敗: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "%s が設定されていません\n", key)
		os.Exit(1)
	}
	return v
}
