import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const {
  mockCreatePluginRegistry,
  mockFindConfigFile,
  mockLoadConfig,
  mockRegistry,
} = vi.hoisted(() => ({
  mockCreatePluginRegistry: vi.fn(),
  mockFindConfigFile: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockRegistry: {
    loadFromConfig: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    register: vi.fn(),
    loadBuiltins: vi.fn(),
  },
}));

vi.mock("@aoagents/ao-core", () => ({
  createPluginRegistry: (...args: unknown[]) => mockCreatePluginRegistry(...args),
  findConfigFile: (...args: unknown[]) => mockFindConfigFile(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  resolveNotifierTarget: (config: { notifiers?: Record<string, { plugin?: string }> }, reference: string) => ({
    reference,
    pluginName: config.notifiers?.[reference]?.plugin ?? reference,
  }),
}));

vi.mock("../../src/lib/plugin-store.js", () => ({
  importPluginModuleFromSource: vi.fn(),
}));

import { registerNotify } from "../../src/commands/notify.js";

function makeConfig() {
  return {
    configPath: "/tmp/agent-orchestrator.yaml",
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: ["alerts"],
    },
    projects: {
      demo: {
        name: "Demo",
        path: "/tmp/demo",
        defaultBranch: "main",
        sessionPrefix: "demo",
      },
    },
    notifiers: {
      alerts: { plugin: "slack" },
    },
    notificationRouting: {
      urgent: ["alerts"],
      action: ["alerts"],
      warning: ["alerts"],
      info: ["alerts"],
    },
    reactions: {},
  };
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerNotify(program);
  return program;
}

describe("notify command", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    mockFindConfigFile.mockReset();
    mockFindConfigFile.mockReturnValue("/tmp/agent-orchestrator.yaml");
    mockLoadConfig.mockReset();
    mockLoadConfig.mockReturnValue(makeConfig());
    mockCreatePluginRegistry.mockReset();
    mockCreatePluginRegistry.mockReturnValue(mockRegistry);
    mockRegistry.loadFromConfig.mockReset();
    mockRegistry.loadFromConfig.mockResolvedValue(undefined);
    mockRegistry.get.mockReset();
    mockRegistry.list.mockReset();
    mockRegistry.register.mockReset();
    mockRegistry.loadBuiltins.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a dry run without sending", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    mockRegistry.get.mockReturnValue({ name: "alerts", notify });

    await createProgram().parseAsync(["node", "test", "notify", "test", "--dry-run"]);

    expect(mockRegistry.loadFromConfig).toHaveBeenCalledWith(makeConfig(), expect.any(Function));
    expect(notify).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Dry run");
  });

  it("sends template data and valid --data overrides", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    mockRegistry.get.mockReturnValue({ name: "alerts", notify });

    await createProgram().parseAsync([
      "node",
      "test",
      "notify",
      "test",
      "--template",
      "ci-failing",
      "--data",
      '{"runId":"123"}',
    ]);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      type: "ci.failing",
      priority: "action",
      data: {
        prNumber: 1579,
        ciStatus: "failing",
        runId: "123",
      },
    });
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 for invalid --data JSON", async () => {
    await expect(
      createProgram().parseAsync(["node", "test", "notify", "test", "--data", "{bad"]),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
      "Invalid --data JSON",
    );
  });

  it("captures one sink webhook payload and closes cleanly", async () => {
    let sinkUrl = "";

    mockRegistry.loadFromConfig.mockImplementation((config: { notifiers: Record<string, { url?: string }> }) => {
      sinkUrl = config.notifiers.sink?.url ?? "";
    });
    mockRegistry.get.mockImplementation((slot: string, name: string) => {
      if (slot !== "notifier" || name !== "sink") return null;
      return {
        name: "sink",
        notify: async (event: unknown) => {
          await fetch(sinkUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "notification", event }),
          });
        },
      };
    });

    await createProgram().parseAsync(["node", "test", "notify", "test", "--sink"]);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Sink received");
    expect(output).toContain("Test notification from ao notify test");
    expect(processExitSpy).not.toHaveBeenCalled();

    await expect(
      fetch(sinkUrl, { method: "POST", body: "{}" }),
    ).rejects.toThrow();
  });

  it("does not start a sink delivery in dry-run mode", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    mockRegistry.get.mockImplementation((slot: string, name: string) => {
      if (slot === "notifier" && name === "sink") {
        return { name: "sink", notify };
      }
      return null;
    });

    await createProgram().parseAsync(["node", "test", "notify", "test", "--sink", "--dry-run"]);

    expect(notify).not.toHaveBeenCalled();
    expect(consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n")).not.toContain(
      "Sink received",
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
