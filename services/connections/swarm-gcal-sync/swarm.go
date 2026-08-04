package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	swarmCheckinsURL = "https://api.foursquare.com/v2/users/self/checkins"
	swarmPageLimit   = 250
)

// SwarmClient は Foursquare のチェックイン API クライアント。
type SwarmClient struct {
	token      string
	apiVersion string
	http       *http.Client
}

// NewSwarmClient はユーザーの OAuth トークンと API バージョン日付 (v) からクライアントを生成する。
func NewSwarmClient(token, apiVersion string) *SwarmClient {
	return &SwarmClient{
		token:      token,
		apiVersion: apiVersion,
		http:       &http.Client{Timeout: 30 * time.Second},
	}
}

// Checkin は同期に必要なチェックインの項目のみを保持する。
type Checkin struct {
	ID             string `json:"id"`
	CreatedAt      int64  `json:"createdAt"`      // epoch 秒 (UTC)
	TimeZoneOffset int    `json:"timeZoneOffset"` // チェックイン地点の UTC オフセット (分)
	Shout          string `json:"shout"`
	Venue          struct {
		Name     string `json:"name"`
		Location struct {
			Address          string   `json:"address"`
			FormattedAddress []string `json:"formattedAddress"`
			Lat              float64  `json:"lat"`
			Lng              float64  `json:"lng"`
		} `json:"location"`
		Categories []struct {
			Name    string `json:"name"`
			Primary bool   `json:"primary"`
			Icon    struct {
				Prefix string `json:"prefix"`
				Suffix string `json:"suffix"`
			} `json:"icon"`
		} `json:"categories"`
	} `json:"venue"`
}

type checkinsResponse struct {
	Response struct {
		Checkins struct {
			Count int       `json:"count"`
			Items []Checkin `json:"items"`
		} `json:"checkins"`
	} `json:"response"`
}

// FetchSince は afterTimestamp (epoch 秒) より後のチェックインを新しい順に取得する。
func (c *SwarmClient) FetchSince(afterTimestamp int64) ([]Checkin, error) {
	var all []Checkin
	for offset := 0; ; offset += swarmPageLimit {
		params := url.Values{"afterTimestamp": {strconv.FormatInt(afterTimestamp, 10)}}
		items, err := c.fetchPage(params, offset)
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
		if len(items) < swarmPageLimit {
			break
		}
	}
	return all, nil
}

// FetchAll は全チェックインをページングして取得する (バックフィル用)。
func (c *SwarmClient) FetchAll() ([]Checkin, error) {
	var all []Checkin
	for offset := 0; ; offset += swarmPageLimit {
		items, err := c.fetchPage(url.Values{}, offset)
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
		if len(items) < swarmPageLimit {
			break
		}
	}
	return all, nil
}

func (c *SwarmClient) fetchPage(extra url.Values, offset int) ([]Checkin, error) {
	params := url.Values{
		"oauth_token": {c.token},
		"v":           {c.apiVersion},
		"sort":        {"newestfirst"},
		"limit":       {strconv.Itoa(swarmPageLimit)},
		"offset":      {strconv.Itoa(offset)},
	}
	maps.Copy(params, extra)

	resp, err := c.http.Get(swarmCheckinsURL + "?" + params.Encode())
	if err != nil {
		return nil, fmt.Errorf("foursquare リクエストに失敗: %w", redactURL(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("foursquare が %s を返しました", resp.Status)
	}

	var decoded checkinsResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("foursquare レスポンスのデコードに失敗: %w", err)
	}
	return decoded.Response.Checkins.Items, nil
}

// foursquareTokenPath は Foursquare ユーザートークンを保存するファイルパスを返す。
func foursquareTokenPath() string {
	if p := os.Getenv("FOURSQUARE_TOKEN_FILE"); p != "" {
		return p
	}
	return "secrets/foursquare-token.json"
}

type foursquareToken struct {
	AccessToken string `json:"access_token"`
}

// loadFoursquareToken は保存済みの Foursquare ユーザートークンを読み込む。
func loadFoursquareToken(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("Foursquare トークンの読み込みに失敗 (%s): %w", path, err)
	}
	var t foursquareToken
	if err := json.Unmarshal(data, &t); err != nil {
		return "", fmt.Errorf("Foursquare トークンファイルの解析に失敗: %w", err)
	}
	if t.AccessToken == "" {
		return "", fmt.Errorf("Foursquare トークンが空です (%s)", path)
	}
	return t.AccessToken, nil
}

// saveFoursquareToken は取得した Foursquare ユーザートークンをファイルに保存する。
func saveFoursquareToken(path, token string) error {
	data, err := json.MarshalIndent(foursquareToken{AccessToken: token}, "", "  ")
	if err != nil {
		return err
	}
	// bearer token なので所有者のみに制限する。コンテナ側は root で動かして読む
	// (compose.yml の user: "0:0")。
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("保存先ディレクトリの作成に失敗 (%s): %w", path, err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("Foursquare トークンの保存に失敗 (%s): %w", path, err)
	}
	return nil
}

// redactURL は *url.Error からクエリ文字列を除去し、トークン等がエラーメッセージ／
// ログに漏れないようにする。Foursquare v2 はトークンをクエリで要求するため URL に
// 載るが、失敗時のラップで露出させない。
func redactURL(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		if u, perr := url.Parse(uerr.URL); perr == nil {
			u.RawQuery = ""
			uerr.URL = u.String()
		}
	}
	return err
}
