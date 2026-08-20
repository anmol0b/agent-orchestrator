package httpd

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/aoagents/agent-orchestrator/backend/internal/config"
	"github.com/aoagents/agent-orchestrator/backend/internal/mobilebridge"
	"github.com/aoagents/agent-orchestrator/backend/internal/terminal"
)

const webTestPassword = "test-password"

// newWebDashChain builds the full LAN wrapper chain (control block → webdash →
// auth → inner) the way NewLANManager assembles it, over a stub inner handler.
func newWebDashChain(t *testing.T, lock *lockout) (http.Handler, *authState) {
	t.Helper()
	st := &authState{}
	st.setHash(mobilebridge.HashPassword(webTestPassword))
	sessions := testSessionManager(t)
	if lock == nil {
		lock = newLockout(5, time.Minute, time.Now)
	}
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("inner"))
	})
	chain := lanControlBlock(wrapWebDash(
		authMiddleware(st, lock, sessions, nil)(inner),
		st, lock, &webDashDeps{sessions: sessions, dist: webAssets()}, nil))
	return chain, st
}

func loginCookie(t *testing.T, ts *httptest.Server) *http.Cookie {
	t.Helper()
	resp, err := http.Post(ts.URL+"/auth/login", "application/json",
		strings.NewReader(`{"password":"`+webTestPassword+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want 200", resp.StatusCode)
	}
	for _, c := range resp.Cookies() {
		if c.Name == webSessionCookieName {
			return c
		}
	}
	t.Fatal("login did not set the session cookie")
	return nil
}

func TestLoginSetsSecureSessionCookie(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/auth/login", "application/json",
		strings.NewReader(`{"password":"`+webTestPassword+`"}`))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body map[string]bool
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || !body["authenticated"] {
		t.Fatalf("body = %+v, err = %v; want authenticated:true", body, err)
	}
	var c *http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == webSessionCookieName {
			c = cookie
		}
	}
	if c == nil {
		t.Fatal("no session cookie set")
	}
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.MaxAge != int(webSessionMaxAge.Seconds()) {
		t.Errorf("cookie flags wrong: %+v", c)
	}
}

func TestLoginRejectsBadPasswordAndMalformedJSON(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/auth/login", "application/json", strings.NewReader(`{"password":"wrong"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("bad password status = %d, want 401", resp.StatusCode)
	}

	resp, err = http.Post(ts.URL+"/auth/login", "application/json", strings.NewReader(`not json`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("malformed status = %d, want 400", resp.StatusCode)
	}
}

func TestLoginSharesLockout(t *testing.T) {
	now := time.Now()
	current := now
	lock := newLockout(3, 30*time.Second, func() time.Time { return current })
	chain, _ := newWebDashChain(t, lock)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	for i := 0; i < 3; i++ {
		resp, _ := http.Post(ts.URL+"/auth/login", "application/json", strings.NewReader(`{"password":"wrong"}`))
		resp.Body.Close()
	}
	// Locked out now — even the correct password is refused.
	resp, err := http.Post(ts.URL+"/auth/login", "application/json",
		strings.NewReader(`{"password":"`+webTestPassword+`"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("locked-out status = %d, want 429", resp.StatusCode)
	}
	// Cooldown elapses: the counter resets and the right password works again.
	current = now.Add(2 * time.Minute)
	resp, err = http.Post(ts.URL+"/auth/login", "application/json",
		strings.NewReader(`{"password":"`+webTestPassword+`"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("post-cooldown status = %d, want 200", resp.StatusCode)
	}
}

func TestAuthSessionReportsCookieValidity(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	get := func(cookie *http.Cookie) bool {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/auth/session", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("session: %v", err)
		}
		defer resp.Body.Close()
		var body map[string]bool
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return body["authenticated"]
	}

	if get(nil) {
		t.Error("no cookie must report unauthenticated")
	}
	if !get(loginCookie(t, ts)) {
		t.Error("valid cookie must report authenticated")
	}
	if get(&http.Cookie{Name: webSessionCookieName, Value: "garbage"}) {
		t.Error("garbage cookie must report unauthenticated")
	}
}

func TestLogoutClearsCookie(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/auth/logout", "", nil)
	if err != nil {
		t.Fatalf("logout: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", resp.StatusCode)
	}
	for _, c := range resp.Cookies() {
		if c.Name == webSessionCookieName && c.MaxAge >= 0 {
			t.Errorf("logout cookie must expire immediately: %+v", c)
		}
	}
}

func TestCookieAuthenticatesAPI(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()
	cookie := loginCookie(t, ts)

	do := func(method string, hdr map[string]string) int {
		req, _ := http.NewRequest(method, ts.URL+"/api/v1/projects", nil)
		req.AddCookie(cookie)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	if got := do(http.MethodGet, nil); got != http.StatusOK {
		t.Errorf("GET with cookie = %d, want 200", got)
	}
	if got := do(http.MethodPost, map[string]string{"Origin": "http://" + ts.Listener.Addr().String()}); got != http.StatusOK {
		t.Errorf("same-origin POST = %d, want 200", got)
	}
	if got := do(http.MethodPost, map[string]string{"Sec-Fetch-Site": "same-origin"}); got != http.StatusOK {
		t.Errorf("Sec-Fetch-Site POST = %d, want 200", got)
	}
	if got := do(http.MethodPost, map[string]string{"Origin": "http://evil.example"}); got != http.StatusForbidden {
		t.Errorf("cross-origin POST = %d, want 403", got)
	}
	if got := do(http.MethodPost, nil); got != http.StatusForbidden {
		t.Errorf("origin-less POST = %d, want 403", got)
	}
}

func TestRotationInvalidatesBrowserSession(t *testing.T) {
	chain, st := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()
	cookie := loginCookie(t, ts)

	st.setHash(mobilebridge.HashPassword("rotated-password"))

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/projects", nil)
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("post-rotation status = %d, want 401", resp.StatusCode)
	}
}

func TestStaleCookieDoesNotLockOut(t *testing.T) {
	lock := newLockout(3, 45*time.Second, time.Now)
	chain, _ := newWebDashChain(t, lock)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	stale := &http.Cookie{Name: webSessionCookieName, Value: "stale"}
	for i := 0; i < 6; i++ {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/projects", nil)
		req.AddCookie(stale)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("stale cookie status = %d, want 401 (never 429)", resp.StatusCode)
		}
	}
	// Bearer still admitted — the stale cookies must not have counted as guesses.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/projects", nil)
	req.Header.Set("Authorization", "Bearer "+webTestPassword)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bearer after stale cookies = %d, want 200", resp.StatusCode)
	}
}

func TestStaticShellServedPublicly(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatalf("get /: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET / = %d, want 200 (the login gate lives in the SPA)", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("index Cache-Control = %q, want no-cache", cc)
	}
}

func TestBlockedPrefixesStayBlockedWithCookie(t *testing.T) {
	chain, _ := newWebDashChain(t, nil)
	ts := httptest.NewServer(chain)
	defer ts.Close()
	cookie := loginCookie(t, ts)

	for _, p := range []string{"/shutdown", "/api/v1/mobile/status", "/internal/telemetry/cli-invoked", "/api/v1/dev/x", "/api/v1/browser/x"} {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+p, nil)
		req.AddCookie(cookie)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("get %s: %v", p, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s = %d, want 404 (loopback-only)", p, resp.StatusCode)
		}
	}
}

func TestLoopbackRouterHasNoWebRoutes(t *testing.T) {
	router := newTestRouter(config.Config{}, discardLogger(), nil)
	ts := httptest.NewServer(router)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/auth/login", "application/json", strings.NewReader(`{"password":"x"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("the loopback listener must never expose /auth/login")
	}
}

func TestMuxWebSocketOriginGuard(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns a stub PTY")
	}
	mgr := terminal.NewManager(nil, nil, discardLogger())
	defer mgr.Close()

	st := &authState{}
	st.setHash(mobilebridge.HashPassword(webTestPassword))
	sessions := testSessionManager(t)
	lock := newLockout(5, time.Minute, time.Now)
	chain := lanControlBlock(wrapWebDash(
		authMiddleware(st, lock, sessions, nil)(newTestRouter(config.Config{}, discardLogger(), mgr)),
		st, lock, &webDashDeps{sessions: sessions, dist: webAssets()}, nil))
	ts := httptest.NewServer(chain)
	defer ts.Close()

	cookie := loginCookie(t, ts)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/mux"
	hdr := http.Header{"Cookie": []string{cookie.String()}}

	// Cross-origin upgrade from a browser session must be refused.
	hdr.Set("Origin", "http://evil.example")
	_, resp, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err == nil {
		t.Fatal("cross-origin cookie-authed websocket must be rejected")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin ws status = %v, want 403", resp)
	}

	// Same-origin upgrade authenticates and upgrades.
	hdr.Set("Origin", "http://"+ts.Listener.Addr().String())
	c, _, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("same-origin ws dial: %v", err)
	}
	_ = c.Close(websocket.StatusNormalClosure, "done")
}

func TestSameOriginRequest(t *testing.T) {
	req := func(origin, sfs, host string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "http://"+host+"/x", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if sfs != "" {
			r.Header.Set("Sec-Fetch-Site", sfs)
		}
		return r
	}
	cases := []struct {
		origin, sfs, host string
		want              bool
	}{
		{"https://pi.tail1234.ts.net", "", "pi.tail1234.ts.net", true},
		{"http://192.168.1.5:3011", "", "192.168.1.5:3011", true},
		{"http://evil.example", "", "pi.tail1234.ts.net", false},
		{"", "same-origin", "pi.tail1234.ts.net", true},
		{"", "cross-site", "pi.tail1234.ts.net", false},
		{"", "", "pi.tail1234.ts.net", false},
		{"not a url", "", "host", false},
	}
	for _, tc := range cases {
		if got := sameOriginRequest(req(tc.origin, tc.sfs, tc.host)); got != tc.want {
			t.Errorf("sameOriginRequest(origin=%q sfs=%q host=%q) = %v, want %v", tc.origin, tc.sfs, tc.host, got, tc.want)
		}
	}
}
