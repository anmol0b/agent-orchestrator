import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebMode, readWebDaemonStatus } from "./web-mode";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("isWebMode", () => {
	it("is false without the build flag", () => {
		vi.stubEnv("VITE_AO_WEB", "");
		expect(isWebMode()).toBe(false);
	});
	it("is true with VITE_AO_WEB=1", () => {
		vi.stubEnv("VITE_AO_WEB", "1");
		expect(isWebMode()).toBe(true);
	});
});

describe("readWebDaemonStatus", () => {
	it("reports ready/remote when the daemon answers healthz", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
		const status = await readWebDaemonStatus();
		expect(status.state).toBe("ready");
		expect(status.connection).toBe("remote");
	});

	it("reports unreachable on a daemon error response", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 502 })));
		const status = await readWebDaemonStatus();
		expect(status.code).toBe("remote_unreachable");
	});

	it("reports unreachable on a network failure", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const status = await readWebDaemonStatus();
		expect(status.code).toBe("remote_unreachable");
	});

	it("probes same-origin with cookies and no caching", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		await readWebDaemonStatus();
		expect(fetchMock).toHaveBeenCalledWith("/healthz", { credentials: "same-origin", cache: "no-store" });
	});
});
