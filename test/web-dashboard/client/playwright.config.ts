import { defineConfig } from "@playwright/test";

// The base URL is the server container over the shared docker network. TLS
// verification is skipped because nginx serves a self-signed cert standing in
// for tailscale serve's real MagicDNS cert — the scheme is still https, so
// Secure cookies, same-origin checks, and the CSP all behave as in production.
// Real-cert verification belongs to the real-VM smoke (W5).
export default defineConfig({
	testDir: ".",
	testMatch: "dashboard.spec.ts",
	timeout: 180_000,
	expect: { timeout: 15_000 },
	retries: 0,
	workers: 1,
	reporter: [["line"]],
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "https://ao-server",
		ignoreHTTPSErrors: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
});
