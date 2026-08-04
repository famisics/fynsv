// Package misskey provides a minimal Misskey REST/streaming client.
package misskey

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"sort"
)

// NoteFile is a Misskey drive file attached to a note.
type NoteFile struct {
	Type string  `json:"type"`
	URL  *string `json:"url"`
}

// Note is the subset of the Misskey note entity the bridge needs.
type Note struct {
	ID         string     `json:"id"`
	UserID     string     `json:"userId"`
	Text       *string    `json:"text"`
	CW         *string    `json:"cw"`
	ReplyID    *string    `json:"replyId"`
	RenoteID   *string    `json:"renoteId"`
	Visibility string     `json:"visibility"`
	Files      []NoteFile `json:"files"`
}

// Client is a Misskey REST API client authenticated with a single token.
type Client struct {
	origin string
	token  string
	http   *http.Client
}

// NewClient returns a Client for the given instance origin and API token.
func NewClient(origin, token string) *Client {
	return &Client{origin: origin, token: token, http: http.DefaultClient}
}

func (c *Client) request(endpoint string, params map[string]any, out any) error {
	body := make(map[string]any, len(params)+1)
	for k, v := range params {
		body[k] = v
	}
	body["i"] = c.token

	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.origin+"/api/"+endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("misskey %s failed: %d %s", endpoint, res.StatusCode, string(b))
	}
	if res.StatusCode == http.StatusNoContent || out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// CreateNote posts a public note, optionally with text and/or attached files.
func (c *Client) CreateNote(text *string, fileIDs []string) (*Note, error) {
	body := map[string]any{"visibility": "public"}
	if text != nil && *text != "" {
		body["text"] = *text
	}
	if len(fileIDs) > 0 {
		body["fileIds"] = fileIDs
	}
	var res struct {
		CreatedNote Note `json:"createdNote"`
	}
	if err := c.request("notes/create", body, &res); err != nil {
		return nil, err
	}
	return &res.CreatedNote, nil
}

// FetchUserNotes returns userID's own notes created after sinceID, oldest first.
func (c *Client) FetchUserNotes(userID, sinceID string) ([]Note, error) {
	var notes []Note
	err := c.request("users/notes", map[string]any{
		"userId":      userID,
		"sinceId":     sinceID,
		"limit":       100,
		"withReplies": true,
		"withRenotes": true,
	}, &notes)
	if err != nil {
		return nil, err
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].ID < notes[j].ID })
	return notes, nil
}

// FetchLatestNote returns userID's single most recent note, or nil if they
// have none.
func (c *Client) FetchLatestNote(userID string) (*Note, error) {
	var notes []Note
	err := c.request("users/notes", map[string]any{
		"userId":      userID,
		"limit":       1,
		"withReplies": true,
		"withRenotes": true,
	}, &notes)
	if err != nil {
		return nil, err
	}
	if len(notes) == 0 {
		return nil, nil
	}
	return &notes[0], nil
}

// ResolveUserID resolves a screen name to its internal Misskey user ID.
func (c *Client) ResolveUserID(username string) (string, error) {
	var res struct {
		ID string `json:"id"`
	}
	if err := c.request("users/show", map[string]any{"username": username}, &res); err != nil {
		return "", err
	}
	return res.ID, nil
}

// UploadToDrive uploads data as a drive file named name with the given
// content type, returning the created file's ID.
func (c *Client) UploadToDrive(data []byte, name, contentType string) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("i", c.token); err != nil {
		return "", err
	}
	if err := w.WriteField("name", name); err != nil {
		return "", err
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, name))
	header.Set("Content-Type", contentType)
	part, err := w.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, c.origin+"/api/drive/files/create", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	res, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		return "", fmt.Errorf("misskey drive/files/create failed: %d %s", res.StatusCode, string(b))
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.ID, nil
}
