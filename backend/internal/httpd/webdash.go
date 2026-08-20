package httpd

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/envelope"
	"github.com/aoagents/agent-orchestrator/backend/internal/mobilebridge"
)

// webDashDeps bundles what the browser-dashboard wrapper needs. It exists only
// on the LAN listener; the loopback listener never sees these routes.
type webDashDeps struct {
	sessions *webSessionManager
	dist     fs.FS
}

// wrapWebDash adds the browser-dashboard surface to the LAN listener:
//
//	GET  /auth/session   — public; reports whether the request's session cookie
//	                       is currently valid.
//	POST /auth/login     — public; exchanges the connection password for an
//	                       ao_web_session cookie. Shares the bearer lockout.
//	POST /auth/logout    — clears the cookie.
//	GET  /, /assets/...  — the embedded SPA (the login gate lives in it), so the
//	                       shell itself is public; every API call past it needs
//	                       the cookie (or the desktop/mobile bearer).
//
// Everything else falls through to next (the auth-wrapped shared router).
// With nil deps the wrapper is a pass-through and none of these routes exist.
func wrapWebDash(next http.Handler, state *authState, lock *lockout, web *webDashDeps, connected *mobileConnectReporter) http.Handler {
	if web == nil || web.sessions == nil || web.dist == nil {
		return next
	}
	return &webDashHandler{next: next, state: state, lock: lock, sessions: web.sessions, dist: web.dist, connected: connected}
}

type webDashHandler struct {
	next      http.Handler
	state     *authState
	lock      *lockout
	sessions  *webSessionManager
	dist      fs.FS
	connected *mobileConnectReporter
}

func (h *webDashHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/auth/session" && r.Method == http.MethodGet:
		h.session(w, r)
	case r.URL.Path == "/auth/login" && r.Method == http.MethodPost:
		h.login(w, r)
	case r.URL.Path == "/auth/logout" && r.Method == http.MethodPost:
		clearWebSessionCookie(w)
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodGet || r.Method == http.MethodHead:
		if h.serveStatic(w, r) {
			return
		}
		h.next.ServeHTTP(w, r)
	default:
		h.next.ServeHTTP(w, r)
	}
}

func (h *webDashHandler) session(w http.ResponseWriter, r *http.Request) {
	authenticated := false
	if c, err := r.Cookie(webSessionCookieName); err == nil {
		authenticated = h.sessions.validate(c.Value, h.state.currentHash())
	}
	writeWebJSON(w, http.StatusOK, map[string]bool{"authenticated": authenticated})
}

func (h *webDashHandler) login(w http.ResponseWriter, r *http.Request) {
	src := sourceKey(r)
	if h.lock.blocked(src) {
		envelope.WriteAPIError(w, r, http.StatusTooManyRequests, "too_many_requests", "LOCKED_OUT",
			"too many failed attempts; try again shortly", nil)
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON",
			"request body must be JSON: {\"password\": \"...\"}", nil)
		return
	}
	if !mobilebridge.PasswordMatches(h.state.currentHash(), body.Password) {
		h.lock.fail(src)
		envelope.WriteAPIError(w, r, http.StatusUnauthorized, "unauthorized", "BAD_PASSWORD",
			"missing or invalid connection password", nil)
		return
	}
	h.lock.reset(src)
	h.connected.report(src)
	setWebSessionCookie(w, h.sessions.issue(h.state.currentHash()))
	writeWebJSON(w, http.StatusOK, map[string]bool{"authenticated": true})
}

// serveStatic serves the embedded SPA shell and its hashed assets. Only "/"
// (and "/index.html") map to index.html — the renderer uses hash-based routing,
// so no SPA path fallback is needed and deep links never hit the server.
// Anything not present in the bundle falls through to the API router (which
// will 404 it under auth), so the static surface can never shadow API routes.
func (h *webDashHandler) serveStatic(w http.ResponseWriter, r *http.Request) bool {
	p := path.Clean("/" + r.URL.Path)
	if p == "/" || p == "/index.html" {
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, h.dist, "index.html")
		return true
	}
	if strings.Contains(p, "..") {
		return false
	}
	name := strings.TrimPrefix(p, "/")
	f, err := h.dist.Open(name)
	if err != nil {
		return false
	}
	_ = f.Close()
	// Hashed build artifacts are immutable; anything else (favicon, manifest)
	// revalidates on every load so a new bundle takes effect immediately.
	if strings.HasPrefix(p, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFileFS(w, r, h.dist, name)
	return true
}

func writeWebJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// sameOriginRequest enforces the CSRF boundary for cookie-authenticated
// requests: the Origin (or, failing that, Sec-Fetch-Site) must identify the
// very host that served the page. Bearer clients never carry cookies, so this
// only ever runs for browser sessions.
func sameOriginRequest(r *http.Request) bool {
	if origin := r.Header.Get("Origin"); origin != "" {
		return originMatchesHost(origin, r.Host)
	}
	return r.Header.Get("Sec-Fetch-Site") == "same-origin"
}

// originMatchesHost reports whether origin's host[:port] equals the request's
// Host header (the same-origin test, scheme aside).
func originMatchesHost(origin, host string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, host)
}
