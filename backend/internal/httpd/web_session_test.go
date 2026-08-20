package httpd

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testSessionManager(t *testing.T) *webSessionManager {
	t.Helper()
	m, err := newWebSessionManager(t.TempDir(), time.Now)
	if err != nil {
		t.Fatalf("newWebSessionManager: %v", err)
	}
	return m
}

func TestWebSessionRoundtrip(t *testing.T) {
	m := testSessionManager(t)
	if !m.validate(m.issue("hash-1"), "hash-1") {
		t.Fatal("freshly issued session should validate")
	}
}

func TestWebSessionRejectsTampering(t *testing.T) {
	m := testSessionManager(t)
	v := m.issue("hash-1")
	// Flip a payload character (keep it valid base64url).
	tampered := v[:4] + "A" + v[5:]
	if v[:4]+"A" == v[:5] {
		tampered = v[:4] + "B" + v[5:]
	}
	if m.validate(tampered, "hash-1") {
		t.Fatal("tampered session must not validate")
	}
	for _, bad := range []string{"", "garbage", "a.b.c", v + "extra"} {
		if m.validate(bad, "hash-1") {
			t.Fatalf("malformed session %q must not validate", bad)
		}
	}
}

func TestWebSessionExpiry(t *testing.T) {
	now := time.Now()
	current := now
	m, err := newWebSessionManager(t.TempDir(), func() time.Time { return current })
	if err != nil {
		t.Fatalf("newWebSessionManager: %v", err)
	}
	v := m.issue("hash-1")
	current = now.Add(webSessionMaxAge - time.Minute)
	if !m.validate(v, "hash-1") {
		t.Fatal("session should validate just before expiry")
	}
	current = now.Add(webSessionMaxAge + time.Minute)
	if m.validate(v, "hash-1") {
		t.Fatal("session must not validate after expiry")
	}
}

func TestWebSessionPasswordRotationInvalidates(t *testing.T) {
	m := testSessionManager(t)
	v := m.issue("old-hash")
	if m.validate(v, "new-hash") {
		t.Fatal("session issued against the old password hash must die on rotation")
	}
}

func TestWebSessionKeyPersistsAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	m1, err := newWebSessionManager(dir, time.Now)
	if err != nil {
		t.Fatalf("first manager: %v", err)
	}
	v := m1.issue("hash-1")
	// A "restarted" daemon builds a fresh manager over the same data dir.
	m2, err := newWebSessionManager(dir, time.Now)
	if err != nil {
		t.Fatalf("second manager: %v", err)
	}
	if !m2.validate(v, "hash-1") {
		t.Fatal("session must survive a daemon restart (persisted key)")
	}
	info, err := os.Stat(filepath.Join(dir, "mobile", webSessionKeyName))
	if err != nil {
		t.Fatalf("key file: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode = %o, want 600", info.Mode().Perm())
	}
}

func TestWebSessionNilManagerNeverValidates(t *testing.T) {
	var m *webSessionManager
	if m.validate("anything", "hash") {
		t.Fatal("nil manager must never validate")
	}
}
