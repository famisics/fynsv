package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"

	"golang.org/x/oauth2"
)

// runGoogleAuth はローカルで OAuth2 同意フローを実行し、refresh token を標準出力する。
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を環境変数から読む。OAuth クライアントの
// 「承認済みリダイレクト URI」に http://127.0.0.1:8765/callback を登録しておくこと。
func runGoogleAuth(ctx context.Context) error {
	clientID := mustEnv("GOOGLE_CLIENT_ID")
	clientSecret := mustEnv("GOOGLE_CLIENT_SECRET")

	const redirect = "http://127.0.0.1:8765/callback"
	cfg := oauthConfig(clientID, clientSecret, redirect)
	// refresh token を確実に得るため offline + consent を指定する。
	authURL := cfg.AuthCodeURL("state",
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "consent"))

	code, err := listenForCode(ctx, ":8765", "/callback", authURL)
	if err != nil {
		return err
	}

	tok, err := cfg.Exchange(ctx, code)
	if err != nil {
		return fmt.Errorf("トークン交換に失敗: %w", err)
	}
	if tok.RefreshToken == "" {
		return fmt.Errorf("refresh token が返りませんでした。Google アカウントのアプリ連携を解除してから再実行してください")
	}

	fmt.Println("\nGOOGLE_REFRESH_TOKEN=" + tok.RefreshToken)
	return nil
}

// runFoursquareAuth はローカルで Foursquare の OAuth code フローを実行し、
// 長期有効なユーザートークンを標準出力する。
// FOURSQUARE_CLIENT_ID / FOURSQUARE_CLIENT_SECRET を環境変数から読む。Foursquare アプリの
// 「Redirect URI」に http://127.0.0.1:8765/callback を登録しておくこと。
func runFoursquareAuth(ctx context.Context) error {
	clientID := mustEnv("FOURSQUARE_CLIENT_ID")
	clientSecret := mustEnv("FOURSQUARE_CLIENT_SECRET")

	const redirect = "http://127.0.0.1:8765/callback"
	authURL := "https://foursquare.com/oauth2/authenticate?" + url.Values{
		"client_id":     {clientID},
		"response_type": {"code"},
		"redirect_uri":  {redirect},
	}.Encode()

	code, err := listenForCode(ctx, ":8765", "/callback", authURL)
	if err != nil {
		return err
	}

	tokenURL := "https://foursquare.com/oauth2/access_token?" + url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirect},
		"code":          {code},
	}.Encode()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, tokenURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("foursquare トークン交換に失敗: %w", err)
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

	fmt.Println("\nFOURSQUARE_OAUTH_TOKEN=" + body.AccessToken)
	return nil
}

// listenForCode はローカルに HTTP サーバを立て、authURL をユーザーに案内し、
// リダイレクトで返ってくる ?code= を受け取る。
func listenForCode(ctx context.Context, addr, path, authURL string) (string, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", fmt.Errorf("ローカルリスナの起動に失敗 (%s): %w", addr, err)
	}
	defer ln.Close()

	codeCh := make(chan string, 1)
	mux := http.NewServeMux()
	mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
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

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "%s が設定されていません\n", key)
		os.Exit(1)
	}
	return v
}
