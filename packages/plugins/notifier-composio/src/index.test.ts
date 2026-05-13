import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OrchestratorEvent, NotifyAction } from "@aoagents/ao-core";
import { manifest, create } from "./index.js";

const { mockToolsExecute, mockConstructorOptions } = vi.hoisted(() => ({
  mockToolsExecute: vi.fn().mockResolvedValue({ successful: true }),
  mockConstructorOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@composio/core", () => {
  function MockComposio(opts: Record<string, unknown>) {
    mockConstructorOptions.push(opts);
    return { tools: { execute: mockToolsExecute } };
  }
  return { Composio: MockComposio };
});

function makeEvent(overrides: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return {
    id: "evt-1",
    type: "session.spawned",
    priority: "info",
    sessionId: "app-1",
    projectId: "my-project",
    timestamp: new Date("2025-06-15T12:00:00Z"),
    message: "Session app-1 spawned successfully",
    data: {},
    ...overrides,
  };
}

describe("notifier-composio", () => {
  const originalEnv = {
    COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
    COMPOSIO_USER_ID: process.env.COMPOSIO_USER_ID,
    COMPOSIO_ENTITY_ID: process.env.COMPOSIO_ENTITY_ID,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConstructorOptions.length = 0;
    mockToolsExecute.mockResolvedValue({ successful: true });
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_USER_ID;
    delete process.env.COMPOSIO_ENTITY_ID;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
  });

  describe("manifest", () => {
    it("has correct metadata", () => {
      expect(manifest.name).toBe("composio");
      expect(manifest.slot).toBe("notifier");
    });

    it("has a version", () => {
      expect(manifest.version).toBe("0.1.0");
    });
  });

  describe("create — config parsing", () => {
    it("reads apiKey from config", async () => {
      const notifier = create({ composioApiKey: "test-key" });
      await notifier.notify(makeEvent());
      expect(mockConstructorOptions[0]).toEqual({ apiKey: "test-key" });
    });

    it("reads apiKey from COMPOSIO_API_KEY env var", async () => {
      process.env.COMPOSIO_API_KEY = "env-key";
      const notifier = create();
      await notifier.notify(makeEvent());
      expect(mockConstructorOptions[0]).toEqual({ apiKey: "env-key" });
    });

    it("resolves env placeholders in composioApiKey config", async () => {
      process.env.COMPOSIO_API_KEY = "placeholder-key";
      const notifier = create({ composioApiKey: "${COMPOSIO_API_KEY}" });
      await notifier.notify(makeEvent());
      expect(mockConstructorOptions[0]).toEqual({ apiKey: "placeholder-key" });
    });

    it("throws on invalid defaultApp", () => {
      expect(() => create({ composioApiKey: "k", defaultApp: "telegram" })).toThrow(
        'Invalid defaultApp: "telegram"',
      );
    });

    it("accepts slack as defaultApp", () => {
      expect(() => create({ composioApiKey: "k", defaultApp: "slack" })).not.toThrow();
    });

    it("accepts discord as defaultApp", () => {
      expect(() => create({ composioApiKey: "k", defaultApp: "discord" })).not.toThrow();
    });

    it("throws on invalid Discord mode", () => {
      expect(() => create({ composioApiKey: "k", defaultApp: "discord", mode: "voice" })).toThrow(
        'Invalid Discord mode: "voice"',
      );
    });

    it("accepts gmail as defaultApp with emailTo", () => {
      expect(() =>
        create({ composioApiKey: "k", defaultApp: "gmail", emailTo: "a@b.com" }),
      ).not.toThrow();
    });

    it("throws when gmail is defaultApp without emailTo", () => {
      expect(() => create({ composioApiKey: "k", defaultApp: "gmail" })).toThrow(
        "emailTo is required",
      );
    });

    it("defaults to slack when defaultApp not specified", async () => {
      const notifier = create({ composioApiKey: "k" });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({
          arguments: expect.objectContaining({ markdown_text: expect.any(String) }),
        }),
      );
    });
  });

  describe("notify", () => {
    it("calls SLACK_SEND_MESSAGE for slack app", async () => {
      const notifier = create({ composioApiKey: "k", defaultApp: "slack" });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith("SLACK_SEND_MESSAGE", expect.any(Object));
    });

    it("calls DISCORDBOT_CREATE_MESSAGE for discord bot mode", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "discord",
        mode: "bot",
        channelId: "1234567890",
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "DISCORDBOT_CREATE_MESSAGE",
        expect.any(Object),
      );
    });

    it("calls DISCORDBOT_EXECUTE_WEBHOOK for discord webhook mode", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "discord",
        mode: "webhook",
        webhookUrl: "https://discord.com/api/webhooks/1234567890/webhook-token",
        connectedAccountId: "ca_should_be_ignored",
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "DISCORDBOT_EXECUTE_WEBHOOK",
        expect.objectContaining({
          arguments: expect.objectContaining({
            webhook_id: "1234567890",
            webhook_token: "webhook-token",
            content: expect.any(String),
          }),
        }),
      );
      expect(mockToolsExecute.mock.calls[0][1]).not.toHaveProperty("connectedAccountId");
    });

    it("uses webhook mode when Discord webhookUrl is configured without mode", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "discord",
        webhookUrl: "https://discord.com/api/webhooks/1234567890/webhook-token",
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "DISCORDBOT_EXECUTE_WEBHOOK",
        expect.any(Object),
      );
    });

    it("fails fast on invalid Discord webhook URLs", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "discord",
        mode: "webhook",
        webhookUrl: "https://discord.com/not-a-webhook",
      });

      await expect(notifier.notify(makeEvent())).rejects.toThrow("Invalid Discord webhookUrl");
    });

    it("calls GMAIL_SEND_EMAIL for gmail app", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "gmail",
        emailTo: "test@test.com",
        connectedAccountId: "ca_gmail",
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "GMAIL_SEND_EMAIL",
        expect.objectContaining({
          connectedAccountId: "ca_gmail",
          arguments: expect.objectContaining({
            recipient_email: "test@test.com",
            subject: "Agent Orchestrator Notification",
          }),
        }),
      );
    });

    it("routes to channelId when set", async () => {
      const notifier = create({ composioApiKey: "k", channelId: "C123" });
      await notifier.notify(makeEvent());

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.channel).toBe("C123");
    });

    it("routes to normalized channelName when channelId not set", async () => {
      const notifier = create({ composioApiKey: "k", channelName: "#general" });
      await notifier.notify(makeEvent());

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.channel).toBe("general");
    });

    it("includes priority emoji in Slack markdown text", async () => {
      const notifier = create({ composioApiKey: "k" });
      await notifier.notify(makeEvent({ priority: "urgent" }));

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).toContain("\u{1F6A8}");
    });

    it("includes prUrl when present as string", async () => {
      const notifier = create({ composioApiKey: "k" });
      await notifier.notify(makeEvent({ data: { prUrl: "https://github.com/pull/1" } }));

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).toContain("https://github.com/pull/1");
    });

    it("ignores prUrl when not a string", async () => {
      const notifier = create({ composioApiKey: "k" });
      await notifier.notify(makeEvent({ data: { prUrl: 42 } }));

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).not.toContain("PR:");
    });

    it("passes userId, connectedAccountId, and default Slack tool version", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "slack",
        userId: "user_123",
        connectedAccountId: "ca_123",
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({
          userId: "user_123",
          connectedAccountId: "ca_123",
          version: "20260508_00",
        }),
      );
    });

    it("keeps entityId as a backward-compatible userId alias", async () => {
      const notifier = create({ composioApiKey: "k", entityId: "legacy-user" });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({ userId: "legacy-user" }),
      );
    });

    it("reads userId from COMPOSIO_USER_ID env var", async () => {
      process.env.COMPOSIO_USER_ID = "env-user";
      const notifier = create({ composioApiKey: "k" });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({ userId: "env-user" }),
      );
    });

    it("supports configured toolVersion overrides", async () => {
      const notifier = create({ composioApiKey: "k", toolVersion: "20260101_00" });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({ version: "20260101_00" }),
      );
    });

    it("supports app-specific toolVersions overrides", async () => {
      const notifier = create({
        composioApiKey: "k",
        toolVersion: "ignored",
        toolVersions: { slack: "20260202_00" },
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({ version: "20260202_00" }),
      );
    });

    it("passes the default Gmail tool version", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "gmail",
        emailTo: "test@test.com",
        connectedAccountId: "ca_gmail",
      });
      await notifier.notify(makeEvent());

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "GMAIL_SEND_EMAIL",
        expect.objectContaining({ version: "20260506_01" }),
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("No toolVersion configured"),
      );
      warnSpy.mockRestore();
    });
  });

  describe("notifyWithActions", () => {
    it("includes action labels in text", async () => {
      const notifier = create({ composioApiKey: "k" });
      const actions: NotifyAction[] = [
        { label: "Merge", url: "https://github.com/merge" },
        { label: "Kill", callbackEndpoint: "/api/kill" },
      ];
      await notifier.notifyWithActions!(makeEvent(), actions);

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).toContain("Merge");
      expect(callArgs.arguments.markdown_text).toContain("Kill");
    });

    it("includes URL actions as links", async () => {
      const notifier = create({ composioApiKey: "k" });
      const actions: NotifyAction[] = [{ label: "View PR", url: "https://github.com/pull/42" }];
      await notifier.notifyWithActions!(makeEvent(), actions);

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).toContain("https://github.com/pull/42");
    });

    it("renders callback-only actions without URL", async () => {
      const notifier = create({ composioApiKey: "k" });
      const actions: NotifyAction[] = [{ label: "Restart", callbackEndpoint: "/api/restart" }];
      await notifier.notifyWithActions!(makeEvent(), actions);

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).toContain("- Restart");
    });

    it("uses correct tool slug for configured app", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "discord",
        mode: "bot",
        channelId: "1234567890",
      });
      const actions: NotifyAction[] = [{ label: "Test", url: "https://example.com" }];
      await notifier.notifyWithActions!(makeEvent(), actions);

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "DISCORDBOT_CREATE_MESSAGE",
        expect.any(Object),
      );
      warnSpy.mockRestore();
    });
  });

  describe("post", () => {
    it("sends text payload", async () => {
      const notifier = create({ composioApiKey: "k" });
      await notifier.post!("Hello from AO");

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.markdown_text).toBe("Hello from AO");
    });

    it("overrides channel from context", async () => {
      const notifier = create({ composioApiKey: "k", channelName: "#default" });
      await notifier.post!("test", { channel: "#override" });

      const callArgs = mockToolsExecute.mock.calls[0][1];
      expect(callArgs.arguments.channel).toBe("override");
    });

    it("uses Gmail recipient_email for plain post messages", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "gmail",
        emailTo: "test@test.com",
        connectedAccountId: "ca_gmail",
      });
      await notifier.post!("Hello from AO");

      expect(mockToolsExecute).toHaveBeenCalledWith(
        "GMAIL_SEND_EMAIL",
        expect.objectContaining({
          connectedAccountId: "ca_gmail",
          arguments: {
            recipient_email: "test@test.com",
            subject: "Agent Orchestrator Notification",
            body: "Hello from AO",
          },
        }),
      );
    });

    it("returns null", async () => {
      const notifier = create({ composioApiKey: "k" });
      const result = await notifier.post!("test");
      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("throws when SDK returns unsuccessful result", async () => {
      mockToolsExecute.mockResolvedValueOnce({
        successful: false,
        error: "channel not found",
      });

      const notifier = create({ composioApiKey: "k" });
      await expect(notifier.notify(makeEvent())).rejects.toThrow("channel not found");
    });

    it("wraps SDK error with descriptive message", async () => {
      mockToolsExecute.mockResolvedValueOnce({
        successful: false,
        error: undefined,
      });

      const notifier = create({ composioApiKey: "k" });
      await expect(notifier.notify(makeEvent())).rejects.toThrow("unknown error");
    });

    it("adds setup guidance when no connected account is found", async () => {
      mockToolsExecute.mockRejectedValueOnce(
        new Error("No connected account found for user default for toolkit slack"),
      );

      const notifier = create({ composioApiKey: "k" });

      await expect(notifier.notify(makeEvent())).rejects.toThrow("ao setup composio");
    });

    it("uses mail setup guidance for Gmail connection errors", async () => {
      mockToolsExecute.mockRejectedValueOnce(
        new Error("No connected account found for user ao-local for toolkit gmail"),
      );

      const notifier = create({
        composioApiKey: "k",
        defaultApp: "gmail",
        emailTo: "test@test.com",
        connectedAccountId: "ca_gmail",
      });

      await expect(notifier.notify(makeEvent())).rejects.toThrow("ao setup composio-mail");
    });

    it("requires connectedAccountId before executing Gmail notifications", async () => {
      const notifier = create({
        composioApiKey: "k",
        defaultApp: "gmail",
        emailTo: "test@test.com",
      });

      await expect(notifier.notify(makeEvent())).rejects.toThrow("connectedAccountId is required");
      expect(mockToolsExecute).not.toHaveBeenCalled();
    });

    it("rejects invalid test client overrides", () => {
      expect(() => create({ composioApiKey: "k", _clientOverride: {} })).toThrow("tools.execute");
    });
  });

  describe("no-op when no apiKey", () => {
    it("does nothing when no api key", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const notifier = create();
      await notifier.notify(makeEvent());
      expect(mockToolsExecute).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No composioApiKey"));
      warnSpy.mockRestore();
    });
  });

  describe("client override", () => {
    it("supports direct @composio/core tools.execute clients", async () => {
      const execute = vi.fn().mockResolvedValue({ successful: true });
      const notifier = create({
        composioApiKey: "k",
        userId: "user_123",
        connectedAccountId: "ca_123",
        _clientOverride: { tools: { execute } },
      });

      await notifier.notify(makeEvent());

      expect(execute).toHaveBeenCalledWith(
        "SLACK_SEND_MESSAGE",
        expect.objectContaining({
          userId: "user_123",
          connectedAccountId: "ca_123",
          arguments: expect.objectContaining({ markdown_text: expect.any(String) }),
        }),
      );
      expect(mockToolsExecute).not.toHaveBeenCalled();
    });
  });
});
