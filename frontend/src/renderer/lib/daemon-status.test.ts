import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDaemonStatus } from "./daemon-status";
import { getApiBaseUrl } from "./api-client";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("applyDaemonStatus in web mode", () => {
	it("points every transport at the serving origin when ready", () => {
		vi.stubEnv("VITE_AO_WEB", "1");
		applyDaemonStatus({ state: "ready", connection: "remote" });
		expect(getApiBaseUrl()).toBe(window.location.origin);
	});

	it("drops the base URL when the daemon is not ready", () => {
		vi.stubEnv("VITE_AO_WEB", "1");
		applyDaemonStatus({ state: "error", connection: "remote", code: "remote_unreachable" });
		expect(getApiBaseUrl()).toBe("");
	});

	it("Electron mode still derives the loopback URL from the port", () => {
		vi.stubEnv("VITE_AO_WEB", "");
		applyDaemonStatus({ state: "ready", port: 3999 });
		expect(getApiBaseUrl()).toBe("http://127.0.0.1:3999");
	});
});
