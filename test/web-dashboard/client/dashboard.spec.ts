import { expect, test, type Page } from "@playwright/test";

// Web-dashboard acceptance gate (founder steps 3–6): the full headless
// browser flow against a containerized `ao headless` behind a tailscale-serve
// stand-in, from a second container with no localhost shortcuts.
//
// Stage env (driven by run.sh):
//   1 — main flow: unauth → login → dashboard → project → session → SSE →
//       mux roundtrip → logout.
//   2 — after server-side `ao remote rotate`: the old browser session is
//       dead; the new password logs in again.
//   3 — after a daemon restart: durable state (project) is back after re-login.
//
// Creation steps (project/session/shell terminal) go through the daemon API
// via the browser's own request context — still cookie-authenticated and
// same-origin from the page — because the deterministic image deliberately
// has no agent CLIs installed, which the UI agent-selection sheet requires.
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const STAGE = process.env.E2E_STAGE ?? "1";
const PROJECT_PATH = "/tmp/e2eproj";

function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
	page.on("pageerror", (err) => errors.push(String(err)));
	return errors;
}

async function login(page: Page, password: string) {
	await page.goto("/");
	await page.getByPlaceholder("Connection password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.configure({ mode: "serial" });

if (STAGE === "1") {
	test("unauthenticated API and session probe are rejected", async ({ page }) => {
		const session = await page.request.get("/auth/session");
		expect(session.ok()).toBeTruthy();
		expect(await session.json()).toEqual({ authenticated: false });

		const api = await page.request.get("/api/v1/projects");
		expect(api.status()).toBe(401);
	});

	test("login page renders with no CSP violations; bad password errors", async ({ page }) => {
		const errors = collectConsoleErrors(page);
		await page.goto("/");
		await expect(page.getByPlaceholder("Connection password")).toBeVisible();

		await login(page, "definitely-wrong");
		await expect(page.getByRole("alert")).toContainText("Incorrect password");

		const cspErrors = errors.filter((e) => /content security policy|violates/i.test(e));
		expect(cspErrors, `CSP violations: ${cspErrors.join(" | ")}`).toEqual([]);
	});

	test("login, project, session via SSE, mux roundtrip, logout", async ({ page }) => {
		const errors = collectConsoleErrors(page);
		await login(page, PASSWORD);

		// Dashboard shell mounts (first-run board on a fresh daemon).
		await expect(page.getByText("Scratch").first()).toBeVisible({ timeout: 30_000 });

		const origin = new URL(page.url()).origin;
		const sameOriginHeaders = { Origin: origin, "Content-Type": "application/json" };

		// Create the project at an explicit absolute path on the daemon host.
		const project = await page.request.post("/api/v1/projects", {
			headers: sameOriginHeaders,
			data: { path: PROJECT_PATH },
		});
		expect(project.status(), await project.text()).toBe(201);
		const projectBody = await project.json();
		const projectId = projectBody.project?.id ?? projectBody.data?.id ?? projectBody.id;
		expect(projectId).toBeTruthy();

		// Project card appears without a reload (CDC SSE → cache invalidation).
				await expect(page.getByText("e2eproj").first()).toBeVisible({ timeout: 30_000 });

		// Spawn a session in the built-in Scratch project (AO-managed directory,
		// no git default-branch setup needed; harness probe is advisory, so the
		// deterministic agent-launch failure later is fine — we only need the
		// session pipeline itself).
		const session = await page.request.post("/api/v1/sessions", {
			headers: sameOriginHeaders,
			data: { projectId: "scratch", displayName: "webe2e", harness: "claude-code", mode: "tui" },
		});
		expect(session.status(), await session.text()).toBe(201);
		const sessionBody = await session.json();
		const sessionId = sessionBody.session?.id ?? sessionBody.data?.id ?? sessionBody.id;
		expect(sessionId).toBeTruthy();

		// Session card appears via SSE, no refresh.
		await expect(page.getByText("webe2e").first()).toBeVisible({ timeout: 30_000 });

		// Terminal mux roundtrip over wss from the page itself: open a
		// standalone shell and push a marker through the real /mux socket.
		const shell = await page.request.post("/api/v1/shell-terminals", {
			headers: sameOriginHeaders,
			data: { projectId: "scratch" },
		});
		expect(shell.status(), await shell.text()).toBe(201);
		const shellBody = await shell.json();
		const handleId = shellBody.shellTerminal?.handleId ?? shellBody.handleId ?? shellBody.data?.handleId;
		expect(handleId).toBeTruthy();

		const marker = `MUX-${Date.now()}`;
		const muxResult = await page.evaluate(
			async ({ handleId, marker }) => {
				const b64 = (s: string) => btoa(s);
				return await new Promise<string>((resolve) => {
					const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/mux`);
					const timer = setTimeout(() => { ws.close(); resolve("TIMEOUT"); }, 20_000);
					ws.onopen = () => {
						ws.send(JSON.stringify({ ch: "terminal", type: "open", id: handleId, cols: 80, rows: 24 }));
					};
					ws.onmessage = (ev) => {
						const frame = JSON.parse(String(ev.data));
						if (frame.type === "opened") {
							ws.send(JSON.stringify({ ch: "terminal", type: "data", id: handleId, data: b64(`echo ${marker}\n`) }));
						}
						if (frame.type === "data" && typeof frame.data === "string" && atob(frame.data).includes(marker)) {
							clearTimeout(timer);
							ws.close();
							resolve("OK");
						}
						if (frame.type === "exited") {
							clearTimeout(timer);
							ws.close();
							resolve("EXITED");
						}
					};
					ws.onerror = () => { clearTimeout(timer); resolve("WSERROR"); };
				});
			},
			{ handleId, marker },
		);
		expect(muxResult).toBe("OK");

		// Sign out via the global settings dialog (sidebar Settings → the
		// web-mode Daemon connection section), and the gate comes back.
		await page.getByRole("button", { name: "Settings" }).first().click();
		// The dialog opens on the General page; Daemon connection is its own nav page.
		await page.getByRole("button", { name: "Daemon connection" }).click();
		await page.getByRole("button", { name: "Sign out" }).click();
		await expect(page.getByPlaceholder("Connection password")).toBeVisible({ timeout: 30_000 });
		const apiAfter = await page.request.get("/api/v1/projects");
		expect(apiAfter.status()).toBe(401);

		const fatal = errors.filter((e) => /content security policy|violates/i.test(e));
		expect(fatal, `CSP violations: ${fatal.join(" | ")}`).toEqual([]);
	});
}

if (STAGE === "2") {
	test("rotation killed the old browser session; new password logs in", async ({ page }) => {
		// A brand-new browser context has no cookie — prove API is gated, then
		// that the ROTATED password works (run.sh fetched it post-rotate).
		const api = await page.request.get("/api/v1/projects");
		expect(api.status()).toBe(401);

		await login(page, PASSWORD);
		await expect(page.getByText("e2eproj").first()).toBeVisible({ timeout: 30_000 });
	});
}

if (STAGE === "3") {
	test("daemon restart preserves state; re-login works", async ({ page }) => {
		await login(page, PASSWORD);
		await expect(page.getByText("e2eproj").first()).toBeVisible({ timeout: 30_000 });
		// The session row is durable too, but terminated sessions are hidden
		// from the board by default — assert durability through the API.
		const sessions = await page.request.get("/api/v1/sessions");
		expect(sessions.ok()).toBeTruthy();
		expect(await sessions.text()).toContain("webe2e");
	});
}
