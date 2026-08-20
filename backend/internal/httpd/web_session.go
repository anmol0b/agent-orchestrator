package httpd

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Browser-dashboard session cookies (ao_web_session). Unlike the path-scoped
// preview cookie (authCookieName), this authenticates the whole LAN surface to
// a browser that completed the /auth/login password challenge.
//
// The cookie is a signed, expiring claim carrying the connection-password hash
// it was issued against. Because authMiddleware validates against the CURRENT
// hash on every request, rotating the connection password invalidates every
// outstanding browser session immediately — the same moment desktop and mobile
// bearers stop working. The signing key is a random 32-byte secret persisted
// mode 0600 next to the mobilebridge state, so sessions survive daemon
// restarts (matching "restart restores remote access without re-pairing").
const (
	webSessionCookieName = "ao_web_session"
	webSessionMaxAge     = 24 * time.Hour
	webSessionKeyName    = "web_session_key"
)

type webSessionManager struct {
	key []byte
	now func() time.Time
}

// newWebSessionManager loads (or creates) the signing key under
// <dataDir>/mobile/, the same directory that holds mobilebridge state.
func newWebSessionManager(dataDir string, now func() time.Time) (*webSessionManager, error) {
	if now == nil {
		now = time.Now
	}
	key, err := loadOrCreateWebSessionKey(filepath.Join(dataDir, "mobile", webSessionKeyName))
	if err != nil {
		return nil, err
	}
	return &webSessionManager{key: key, now: now}, nil
}

func loadOrCreateWebSessionKey(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil && len(b) == sha256.Size {
		return b, nil
	}
	key := make([]byte, sha256.Size)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate web session key: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create web session key dir: %w", err)
	}
	// Atomic write (temp + rename), mirroring mobilebridge config Save.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".webkey-*")
	if err != nil {
		return nil, fmt.Errorf("create web session key: %w", err)
	}
	if _, err := tmp.Write(key); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		return nil, fmt.Errorf("write web session key: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, fmt.Errorf("write web session key: %w", err)
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, fmt.Errorf("protect web session key: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, fmt.Errorf("install web session key: %w", err)
	}
	return key, nil
}

type webSessionClaims struct {
	Exp    int64  `json:"exp"`
	PwHash string `json:"pwhash"`
}

// issue signs fresh claims bound to the current connection-password hash.
func (m *webSessionManager) issue(pwHash string) string {
	payload, _ := json.Marshal(webSessionClaims{Exp: m.now().Add(webSessionMaxAge).Unix(), PwHash: pwHash})
	mac := hmac.New(sha256.New, m.key)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// validate reports whether the cookie value is a well-formed, unexpired,
// correctly signed session issued against currentHash.
func (m *webSessionManager) validate(value, currentHash string) bool {
	if m == nil || len(m.key) == 0 || currentHash == "" {
		return false
	}
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, m.key)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return false
	}
	var claims webSessionClaims
	if json.Unmarshal(payload, &claims) != nil {
		return false
	}
	if m.now().Unix() >= claims.Exp {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(claims.PwHash), []byte(currentHash)) == 1
}

// setWebSessionCookie writes the session cookie. Secure is always set: the
// supported dashboard path is tailnet HTTPS via tailscale serve (ADR 0001),
// and a Secure cookie simply is not stored by browsers over plain-LAN HTTP,
// which is the fail-closed behavior we want there.
func setWebSessionCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     webSessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   int(webSessionMaxAge.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearWebSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     webSessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}
