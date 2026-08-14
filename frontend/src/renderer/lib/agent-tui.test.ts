import { describe, expect, it } from "vitest";
import { clearConversationCommand } from "./agent-tui";

describe("clearConversationCommand", () => {
	it("returns the TUI reset command for supported providers", () => {
		expect(clearConversationCommand("claude-code")).toBe("/clear");
		expect(clearConversationCommand("codex")).toBe("/clear");
	});

	it("returns undefined for unsupported or missing providers so the action hides", () => {
		expect(clearConversationCommand("opencode")).toBeUndefined();
		expect(clearConversationCommand("claude")).toBeUndefined();
		expect(clearConversationCommand(undefined)).toBeUndefined();
	});
});
