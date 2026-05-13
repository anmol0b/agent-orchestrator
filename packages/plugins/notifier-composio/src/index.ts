import type {
  PluginModule,
  Notifier,
  OrchestratorEvent,
  NotifyAction,
  NotifyContext,
  EventPriority,
} from "@aoagents/ao-core";

export const manifest = {
  name: "composio",
  slot: "notifier" as const,
  description: "Notifier plugin: Composio unified notifications (Slack, Discord, email)",
  version: "0.1.0",
};

const PRIORITY_EMOJI: Record<EventPriority, string> = {
  urgent: "\u{1F6A8}",
  action: "\u{1F449}",
  warning: "\u{26A0}\u{FE0F}",
  info: "\u{2139}\u{FE0F}",
};

type ComposioApp = "slack" | "discord" | "gmail";
type DiscordMode = "webhook" | "bot";

const APP_TOOL_SLUG: Record<ComposioApp, string> = {
  slack: "SLACK_SEND_MESSAGE",
  discord: "DISCORDBOT_CREATE_MESSAGE",
  gmail: "GMAIL_SEND_EMAIL",
};

const DEFAULT_TOOL_VERSION: Partial<Record<ComposioApp, string>> = {
  slack: "20260508_00",
  discord: "20260429_01",
  gmail: "20260506_01",
};

const VALID_APPS = new Set<string>(["slack", "discord", "gmail"]);
const VALID_DISCORD_MODES = new Set<string>(["webhook", "bot"]);

const GMAIL_SUBJECT = "Agent Orchestrator Notification";
const DISCORD_WEBHOOK_TOOL_SLUG = "DISCORDBOT_EXECUTE_WEBHOOK";

interface ComposioExecuteParams {
  userId: string;
  connectedAccountId?: string;
  version?: string;
  dangerouslySkipVersionCheck?: boolean;
  arguments: Record<string, unknown>;
}

interface ComposioExecuteResult {
  successful?: boolean;
  data?: unknown;
  error?: unknown;
}

interface ComposioToolsClient {
  tools: {
    execute(action: string, params: ComposioExecuteParams): Promise<ComposioExecuteResult>;
  };
}

function isComposioToolsClient(value: unknown): value is ComposioToolsClient {
  return (
    value !== null &&
    typeof value === "object" &&
    "tools" in value &&
    typeof (value as { tools?: { execute?: unknown } }).tools?.execute === "function"
  );
}

/**
 * Lazy-load the bundled @composio/core SDK.
 *
 * Dynamic import keeps the plugin lightweight at module-load time and lets
 * tests inject a mock client at the I/O boundary.
 */
async function loadComposioSDK(apiKey: string): Promise<ComposioToolsClient | null> {
  try {
    const mod = (await import("@composio/core")) as unknown as Record<string, unknown>;
    const ComposioClass = (mod.Composio ??
      (mod.default as Record<string, unknown> | undefined)?.Composio ??
      mod.default) as (new (opts: { apiKey: string }) => unknown) | undefined;

    if (typeof ComposioClass !== "function") {
      throw new Error("Could not find Composio class in @composio/core module");
    }

    const client = new ComposioClass({ apiKey });
    if (!isComposioToolsClient(client)) {
      throw new Error("Composio SDK client does not expose tools.execute()");
    }

    return client;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    if (
      message.includes("Cannot find module") ||
      message.includes("Cannot find package") ||
      message.includes("MODULE_NOT_FOUND") ||
      code === "ERR_MODULE_NOT_FOUND"
    ) {
      return null;
    }
    throw err;
  }
}

function stringConfig(
  config: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = config?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function resolveEnvReference(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/);
  if (!match) return value;
  return process.env[match[1] ?? match[2] ?? ""];
}

function boolConfig(config: Record<string, unknown> | undefined, key: string): boolean {
  return config?.[key] === true;
}

function parseDiscordWebhookUrl(webhookUrl: string): { webhookId: string; webhookToken: string } {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("[notifier-composio] Invalid Discord webhookUrl.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const webhookIndex = segments.findIndex((segment) => segment === "webhooks");
  const webhookId = webhookIndex >= 0 ? segments[webhookIndex + 1] : undefined;
  const webhookToken = webhookIndex >= 0 ? segments[webhookIndex + 2] : undefined;

  if (!webhookId || !webhookToken) {
    throw new Error(
      "[notifier-composio] Invalid Discord webhookUrl. Expected https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN",
    );
  }

  return {
    webhookId: decodeURIComponent(webhookId),
    webhookToken: decodeURIComponent(webhookToken),
  };
}

function resolveDiscordMode(
  config: Record<string, unknown> | undefined,
  defaultApp: ComposioApp,
  webhookUrl: string | undefined,
): DiscordMode | undefined {
  if (defaultApp !== "discord") return undefined;

  const mode = stringConfig(config, "mode");
  if (mode) {
    if (!VALID_DISCORD_MODES.has(mode)) {
      throw new Error(
        `[notifier-composio] Invalid Discord mode: "${mode}". Must be one of: webhook, bot`,
      );
    }
    return mode as DiscordMode;
  }

  return webhookUrl ? "webhook" : "bot";
}

function formatNotifyText(event: OrchestratorEvent): string {
  const emoji = PRIORITY_EMOJI[event.priority];
  const parts = [`${emoji} *${event.type}* — ${event.sessionId}`, event.message];

  const prUrl = typeof event.data.prUrl === "string" ? event.data.prUrl : undefined;
  if (prUrl) {
    parts.push(`PR: ${prUrl}`);
  }

  return parts.join("\n");
}

function formatActionsText(event: OrchestratorEvent, actions: NotifyAction[]): string {
  const base = formatNotifyText(event);
  const actionLines = actions.map((a) => {
    if (a.url) return `- ${a.label}: ${a.url}`;
    return `- ${a.label}`;
  });

  return `${base}\n\nActions:\n${actionLines.join("\n")}`;
}

function normalizeSlackChannel(channel: string | undefined): string | undefined {
  return channel?.replace(/^#/, "");
}

function formatUnknownError(value: unknown): string {
  if (value instanceof Error) {
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      const causeMessage = formatUnknownError(cause);
      if (causeMessage && !value.message.includes(causeMessage)) {
        return `${value.message}: ${causeMessage}`;
      }
    }
    return value.message;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatComposioError(err: unknown, app: ComposioApp, discordMode?: DiscordMode): Error {
  const message = formatUnknownError(err);
  const lower = message.toLowerCase();
  if (lower.includes("connected account") || lower.includes("could not find a connection")) {
    const setupCommand = setupCommandForApp(app, discordMode);
    if (app === "discord" && discordMode === "webhook") {
      return new Error(
        `[notifier-composio] ${message}. Run \`${setupCommand}\` to refresh the Discord webhook config. Webhook mode does not use connectedAccountId.`,
      );
    }
    return new Error(
      `[notifier-composio] ${message}. Run \`${setupCommand}\`, connect ${app} in Composio, or set connectedAccountId / userId. entityId is still supported as an alias for userId.`,
    );
  }

  return err instanceof Error ? err : new Error(message);
}

function setupCommandForApp(app: ComposioApp, discordMode?: DiscordMode): string {
  if (app === "discord") {
    return discordMode === "webhook"
      ? "ao setup composio-discord"
      : "ao setup composio-discord-bot";
  }
  if (app === "gmail") return "ao setup composio-mail";
  return "ao setup composio";
}

function buildToolArgs(
  app: ComposioApp,
  discordMode: DiscordMode | undefined,
  text: string,
  channelId?: string,
  channelName?: string,
  emailTo?: string,
  webhookUrl?: string,
): Record<string, unknown> {
  if (app === "slack") {
    const args: Record<string, unknown> = { markdown_text: text };
    const channel = channelId ?? normalizeSlackChannel(channelName);
    if (channel) args.channel = channel;
    return args;
  }

  if (app === "discord") {
    if (discordMode === "webhook") {
      if (!webhookUrl) {
        throw new Error(
          '[notifier-composio] webhookUrl is required when defaultApp is "discord" and mode is "webhook"',
        );
      }
      const parsed = parseDiscordWebhookUrl(webhookUrl);
      return {
        webhook_id: parsed.webhookId,
        webhook_token: parsed.webhookToken,
        content: text,
      };
    }

    const args: Record<string, unknown> = { content: text };
    // Discord requires numeric channel IDs — channelName is accepted as a manual fallback.
    if (channelId) args.channel_id = channelId;
    else if (channelName) args.channel_id = channelName;
    else {
      throw new Error(
        '[notifier-composio] channelId is required when defaultApp is "discord" and mode is "bot"',
      );
    }
    return args;
  }

  return {
    recipient_email: emailTo ?? "",
    subject: GMAIL_SUBJECT,
    body: text,
  };
}

function resolveToolVersion(
  config: Record<string, unknown> | undefined,
  app: ComposioApp,
): string | undefined {
  const toolVersions = config?.["toolVersions"];
  if (toolVersions && typeof toolVersions === "object") {
    const appVersion = (toolVersions as Record<string, unknown>)[app];
    if (typeof appVersion === "string" && appVersion.trim().length > 0) {
      return appVersion;
    }
  }

  return stringConfig(config, "toolVersion") ?? DEFAULT_TOOL_VERSION[app];
}

function resolveToolSlug(app: ComposioApp, discordMode: DiscordMode | undefined): string {
  if (app === "discord" && discordMode === "webhook") return DISCORD_WEBHOOK_TOOL_SLUG;
  return APP_TOOL_SLUG[app];
}

export function create(config?: Record<string, unknown>): Notifier {
  const apiKey =
    resolveEnvReference(stringConfig(config, "composioApiKey")) ?? process.env.COMPOSIO_API_KEY;
  const defaultApp: ComposioApp =
    typeof config?.defaultApp === "string" && VALID_APPS.has(config.defaultApp)
      ? (config.defaultApp as ComposioApp)
      : "slack";
  const channelName = stringConfig(config, "channelName");
  const channelId = stringConfig(config, "channelId");
  const webhookUrl = resolveEnvReference(stringConfig(config, "webhookUrl"));
  const discordMode = resolveDiscordMode(config, defaultApp, webhookUrl);
  const userId =
    stringConfig(config, "userId") ??
    stringConfig(config, "entityId") ??
    process.env.COMPOSIO_USER_ID ??
    process.env.COMPOSIO_ENTITY_ID ??
    "ao-local";
  const emailTo = stringConfig(config, "emailTo");
  const toolVersion = resolveToolVersion(config, defaultApp);
  const forceSkipVersionCheck = boolConfig(config, "dangerouslySkipVersionCheck");
  const connectedAccountId =
    defaultApp === "discord" && discordMode === "webhook"
      ? undefined
      : stringConfig(config, "connectedAccountId");

  const clientOverride =
    config?._clientOverride !== undefined && config._clientOverride !== null
      ? config._clientOverride
      : undefined;

  if (clientOverride !== undefined && !isComposioToolsClient(clientOverride)) {
    throw new Error("[notifier-composio] _clientOverride must expose tools.execute()");
  }

  if (typeof config?.defaultApp === "string" && !VALID_APPS.has(config.defaultApp)) {
    throw new Error(
      `[notifier-composio] Invalid defaultApp: "${config.defaultApp}". Must be one of: slack, discord, gmail`,
    );
  }

  if (defaultApp === "gmail" && !emailTo) {
    throw new Error('[notifier-composio] emailTo is required when defaultApp is "gmail"');
  }

  if (defaultApp === "discord" && discordMode === "webhook" && !webhookUrl) {
    throw new Error(
      '[notifier-composio] webhookUrl is required when defaultApp is "discord" and mode is "webhook"',
    );
  }

  let client: ComposioToolsClient | null | undefined = clientOverride as
    | ComposioToolsClient
    | undefined;
  let warnedNoKey = false;
  let warnedSkipVersion = false;
  let sdkMissing = false;

  async function getClient(): Promise<ComposioToolsClient | null> {
    if (clientOverride) return clientOverride as ComposioToolsClient;

    if (!apiKey) {
      if (!warnedNoKey) {
        console.warn(
          "[notifier-composio] No composioApiKey or COMPOSIO_API_KEY configured — notifications will be no-ops",
        );
        warnedNoKey = true;
      }
      return null;
    }

    if (sdkMissing) return null;

    if (client === undefined) {
      client = await loadComposioSDK(apiKey);
      if (client === null) {
        sdkMissing = true;
        console.warn(
          "[notifier-composio] @composio/core package is not installed — notifications will be no-ops.",
        );
        return null;
      }
    }

    return client;
  }

  async function executeWithTimeout(
    composio: ComposioToolsClient,
    action: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const timeoutMs = 30_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const executeParams: ComposioExecuteParams = {
      userId,
      arguments: args,
      ...(connectedAccountId ? { connectedAccountId } : {}),
      ...(toolVersion ? { version: toolVersion } : { dangerouslySkipVersionCheck: true }),
      ...(forceSkipVersionCheck ? { dangerouslySkipVersionCheck: true } : {}),
    };

    if (!toolVersion && !warnedSkipVersion) {
      console.warn(
        `[notifier-composio] No toolVersion configured for ${defaultApp}; using Composio latest-version execution.`,
      );
      warnedSkipVersion = true;
    }

    const actionPromise = composio.tools.execute(action, executeParams);
    // Prevent unhandled rejection if the timeout fires and actionPromise later rejects.
    actionPromise.catch(() => {});

    const result = await Promise.race([
      actionPromise,
      new Promise<never>((_, reject) => {
        timeoutSignal.addEventListener(
          "abort",
          () => {
            reject(
              new Error(
                `[notifier-composio] Composio API call timed out after ${timeoutMs / 1000}s`,
              ),
            );
          },
          { once: true },
        );
      }),
    ]).catch((err: unknown) => {
      throw formatComposioError(err, defaultApp, discordMode);
    });

    if (result.successful === false) {
      throw new Error(
        `[notifier-composio] Composio action ${action} failed: ${formatUnknownError(result.error ?? "unknown error")}`,
      );
    }
  }

  function assertGmailConnectedAccount(): void {
    if (defaultApp === "gmail" && !connectedAccountId) {
      throw new Error(
        '[notifier-composio] connectedAccountId is required when defaultApp is "gmail". Connect Gmail in Composio, then run `ao setup composio-mail`, or set notifiers.<name>.connectedAccountId.',
      );
    }
  }

  return {
    name: "composio",

    async notify(event: OrchestratorEvent): Promise<void> {
      const composio = await getClient();
      if (!composio) return;
      assertGmailConnectedAccount();

      const text = formatNotifyText(event);
      const toolSlug = resolveToolSlug(defaultApp, discordMode);
      const args = buildToolArgs(
        defaultApp,
        discordMode,
        text,
        channelId,
        channelName,
        emailTo,
        webhookUrl,
      );

      await executeWithTimeout(composio, toolSlug, args);
    },

    async notifyWithActions(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void> {
      const composio = await getClient();
      if (!composio) return;
      assertGmailConnectedAccount();

      const text = formatActionsText(event, actions);
      const toolSlug = resolveToolSlug(defaultApp, discordMode);
      const args = buildToolArgs(
        defaultApp,
        discordMode,
        text,
        channelId,
        channelName,
        emailTo,
        webhookUrl,
      );

      await executeWithTimeout(composio, toolSlug, args);
    },

    async post(message: string, context?: NotifyContext): Promise<string | null> {
      const composio = await getClient();
      if (!composio) return null;
      assertGmailConnectedAccount();

      const channel = context?.channel ?? channelId ?? channelName;
      const slackChannel = normalizeSlackChannel(channel);
      const toolSlug = resolveToolSlug(defaultApp, discordMode);

      const args: Record<string, unknown> =
        defaultApp === "gmail"
          ? { recipient_email: emailTo ?? "", subject: GMAIL_SUBJECT, body: message }
          : defaultApp === "discord"
            ? buildToolArgs(
                defaultApp,
                discordMode,
                message,
                discordMode === "bot" ? channel : channelId,
                channelName,
                emailTo,
                webhookUrl,
              )
            : { markdown_text: message, ...(slackChannel ? { channel: slackChannel } : {}) };

      await executeWithTimeout(composio, toolSlug, args);
      return null;
    },
  };
}

export default { manifest, create } satisfies PluginModule<Notifier>;
