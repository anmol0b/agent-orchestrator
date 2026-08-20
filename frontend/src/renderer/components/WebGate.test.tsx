import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGate } from "./WebGate";

function fetchSequence(...responses: Array<{ status: number; body?: unknown }>) {
	const mock = vi.fn();
	for (const r of responses) {
		mock.mockResolvedValueOnce(
			new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "Content-Type": "application/json" } }),
		);
	}
	vi.stubGlobal("fetch", mock);
	return mock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("WebGate", () => {
	it("shows the login form when no session exists and mounts nothing else", async () => {
		fetchSequence({ status: 200, body: { authenticated: false } });
		render(
			<WebGate>
				<div>APP CONTENT</div>
			</WebGate>,
		);
		expect(await screen.findByPlaceholderText("Connection password")).toBeInTheDocument();
		expect(screen.queryByText("APP CONTENT")).not.toBeInTheDocument();
	});

	it("mounts the app immediately for an authenticated session", async () => {
		fetchSequence({ status: 200, body: { authenticated: true } });
		render(
			<WebGate>
				<div>APP CONTENT</div>
			</WebGate>,
		);
		expect(await screen.findByText("APP CONTENT")).toBeInTheDocument();
	});

	it("logs in and mounts the app on success", async () => {
		const mock = fetchSequence(
			{ status: 200, body: { authenticated: false } },
			{ status: 200, body: { authenticated: true } },
		);
		render(
			<WebGate>
				<div>APP CONTENT</div>
			</WebGate>,
		);
		await userEvent.type(await screen.findByPlaceholderText("Connection password"), "s3cret");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByText("APP CONTENT")).toBeInTheDocument();
		expect(mock).toHaveBeenLastCalledWith("/auth/login", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
	});

	it("surfaces a bad password", async () => {
		fetchSequence({ status: 200, body: { authenticated: false } }, { status: 401 });
		render(
			<WebGate>
				<div>APP CONTENT</div>
			</WebGate>,
		);
		await userEvent.type(await screen.findByPlaceholderText("Connection password"), "wrong");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password");
		expect(screen.queryByText("APP CONTENT")).not.toBeInTheDocument();
	});

	it("surfaces lockout", async () => {
		fetchSequence({ status: 200, body: { authenticated: false } }, { status: 429 });
		render(
			<WebGate>
				<div>APP CONTENT</div>
			</WebGate>,
		);
		await userEvent.type(await screen.findByPlaceholderText("Connection password"), "wrong");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many failed attempts"));
	});
});
