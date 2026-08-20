import { describe, expect, it } from "vitest";
import { electronCsp, webCsp } from "./csp";

describe("webCsp", () => {
	it("is strictly same-origin", () => {
		const csp = webCsp();
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("default-src 'self'");
		expect(csp).not.toContain("127.0.0.1");
		expect(csp).not.toContain("posthog");
		expect(csp).not.toContain("ws://");
		expect(csp).not.toContain("http://");
	});
});

describe("electronCsp", () => {
	it("pins loopback transports plus telemetry origins", () => {
		const csp = electronCsp(["https://us.i.posthog.com"]);
		expect(csp).toContain("http://127.0.0.1:*");
		expect(csp).toContain("ws://127.0.0.1:*");
		expect(csp).toContain("https://us.i.posthog.com");
	});
});
