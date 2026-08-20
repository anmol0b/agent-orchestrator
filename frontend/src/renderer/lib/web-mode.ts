// Real browser mode (VITE_AO_WEB=1): the renderer is served by the headless
// daemon itself (tailnet HTTPS, authenticated LAN listener) and talks to it
// same-origin — no Electron, no preload bridge, no preview mocks. Distinct
// from VITE_NO_ELECTRON, which is the mock-data developer preview.
//
// Read lazily (a function, not a const) so tests can vi.stubEnv after import.
export function isWebMode(): boolean {
	return import.meta.env.VITE_AO_WEB === "1";
}

export type WebDaemonStatus = {
	state: "starting" | "ready" | "stopped" | "error";
	connection?: "local" | "remote";
	code?: string;
	message?: string;
};

// readWebDaemonStatus replaces the Electron supervisor's daemon.getStatus IPC:
// the daemon's health probe over the same-origin cookie session. A 401 means
// the browser session expired or was rotated out — bounce through the login
// gate by reloading (the gate re-checks /auth/session before mounting the app).
export async function readWebDaemonStatus(): Promise<WebDaemonStatus> {
	try {
		const resp = await fetch("/healthz", { credentials: "same-origin", cache: "no-store" });
		if (resp.ok) {
			return { state: "ready", connection: "remote" };
		}
		if (resp.status === 401 || resp.status === 403) {
			window.location.reload();
			// Never reached before the reload starts; keeps callers settled.
			return { state: "error", connection: "remote", code: "remote_unauthorized", message: "Session expired" };
		}
		return {
			state: "error",
			connection: "remote",
			code: "remote_unreachable",
			message: `AO daemon returned ${resp.status}`,
		};
	} catch {
		return {
			state: "error",
			connection: "remote",
			code: "remote_unreachable",
			message: "AO daemon is unreachable",
		};
	}
}
