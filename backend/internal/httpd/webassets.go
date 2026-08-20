package httpd

import (
	"embed"
	"io/fs"
)

// webDistFS embeds the production browser build of the renderer (the
// VITE_AO_WEB=1 bundle). The dist tree is a generated artifact: produced by
// `npm run build:web` in frontend/ and synced here by
// scripts/sync-web-assets.sh; CI fails if the committed copy drifts from the
// source (same convention as apispec/openapi.yaml).
//
// The all: prefix is load-bearing: the router's lazily imported chunks are
// named `_shell-*.js`, and go:embed silently drops files starting with "_"
// or "." without it — serving the login page but 404ing every route chunk.
//
//go:embed all:webassets/dist
var webDistFS embed.FS

// webAssets returns the embedded web bundle rooted at the dist directory.
func webAssets() fs.FS {
	sub, err := fs.Sub(webDistFS, "webassets/dist")
	if err != nil {
		// Unreachable: the path is a compile-time constant embedded above.
		return webDistFS
	}
	return sub
}
