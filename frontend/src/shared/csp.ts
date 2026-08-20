// Content-Security-Policy strings injected into the built renderer's
// index.html at build time (see injectCspMeta in vite.renderer.config.ts).
// Extracted so the web-build policy can be unit-tested without importing the
// vite config.

export function electronCsp(posthogOrigins: string[]): string {
	return [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: http://127.0.0.1:*",
		"font-src 'self' data:",
		["connect-src", "'self'", "http://127.0.0.1:*", "ws://127.0.0.1:*", ...posthogOrigins].filter(Boolean).join(" "),
		"object-src 'none'",
		"base-uri 'self'",
		"frame-src 'none'",
	].join("; ");
}

// Web mode (VITE_AO_WEB=1): the daemon serves this bundle, so every transport
// (REST, SSE, WebSocket) is same-origin — 'self' covers wss: on an https page
// per CSP3. No PostHog: a tailnet dashboard must not phone home, and web mode
// never bootstraps renderer telemetry anyway.
export function webCsp(): string {
	return [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"form-action 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"frame-src 'none'",
	].join("; ");
}
