import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
  escapeAppleScript,
  type PluginModule,
  type Notifier,
  type OrchestratorEvent,
  type NotifyAction,
  type EventPriority,
} from "@aoagents/ao-core";

export const manifest = {
  name: "desktop",
  slot: "notifier" as const,
  description: "Notifier plugin: OS desktop notifications",
  version: "0.1.0",
};

// Re-export for backwards compatibility
export { escapeAppleScript } from "@aoagents/ao-core";

type DesktopBackend = "auto" | "ao-app" | "terminal-notifier" | "osascript";
let nativeNotificationSequence = 0;

interface MacDeliveryOptions {
  backend: DesktopBackend;
  appPath: string;
  useTerminalNotifier: boolean;
}

/**
 * Map event priority to notification urgency:
 * - urgent: sound alert
 * - action: normal notification
 * - info/warning: silent
 */
function shouldPlaySound(priority: EventPriority, soundEnabled: boolean): boolean {
  if (!soundEnabled) return false;
  return priority === "urgent";
}

function formatTitle(event: OrchestratorEvent): string {
  const prefix = event.priority === "urgent" ? "URGENT" : "Agent Orchestrator";
  return `${prefix} [${event.sessionId}]`;
}

function formatMessage(event: OrchestratorEvent): string {
  return event.message;
}

function formatActionsMessage(event: OrchestratorEvent, actions: NotifyAction[]): string {
  const actionLabels = actions.map((a) => a.label).join(" | ");
  return `${event.message}\n\nActions: ${actionLabels}`;
}

function defaultMacAppPath(): string {
  return join(homedir(), "Applications", "AO Notifier.app");
}

function macAppExecutable(appPath: string): string {
  return join(appPath, "Contents", "MacOS", "ao-notifier");
}

function nativeNotificationId(event: OrchestratorEvent): string {
  nativeNotificationSequence += 1;
  return `${event.id}.${Date.now()}.${process.pid}.${nativeNotificationSequence}`;
}

function nativeThreadId(): string {
  return "ao.notifications";
}

function detectAoNotifierApp(appPath: string): boolean {
  return existsSync(macAppExecutable(appPath));
}

function parseBackend(value: unknown): DesktopBackend {
  if (
    value === "auto" ||
    value === "ao-app" ||
    value === "terminal-notifier" ||
    value === "osascript"
  ) {
    return value;
  }
  return "auto";
}

/** Check once at create() time whether terminal-notifier is available. */
function detectTerminalNotifier(): boolean {
  try {
    execFileSync("which", ["terminal-notifier"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a desktop notification using terminal-notifier / osascript (macOS) or
 * notify-send (Linux). Falls back gracefully if neither is available.
 *
 * On macOS, when `terminal-notifier` is installed, notifications support
 * click-to-open: clicking the banner opens `openUrl` in the default browser.
 * Without it, the osascript fallback is used (no click-through).
 */
function sendNotification(
  title: string,
  message: string,
  event: OrchestratorEvent,
  options: {
    sound: boolean;
    isUrgent: boolean;
    mac: MacDeliveryOptions;
    openUrl?: string;
    actions?: NotifyAction[];
    fallbackMessage?: string;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform();

    if (os === "darwin") {
      const backend =
        options.mac.backend === "auto"
          ? detectAoNotifierApp(options.mac.appPath)
            ? "ao-app"
            : options.mac.useTerminalNotifier
              ? "terminal-notifier"
              : "osascript"
          : options.mac.backend;

      if (backend === "ao-app") {
        if (!detectAoNotifierApp(options.mac.appPath)) {
          reject(new Error("AO Notifier.app is not installed. Run: ao setup desktop"));
          return;
        }

        const urlActions = (options.actions ?? []).filter(
          (action): action is NotifyAction & { url: string } => typeof action.url === "string",
        );
        const payload = {
          notificationId: nativeNotificationId(event),
          threadId: nativeThreadId(),
          title,
          body: message,
          sound: options.sound,
          defaultOpenUrl: options.openUrl,
          event: {
            id: event.id,
            type: event.type,
            priority: event.priority,
            sessionId: event.sessionId,
            projectId: event.projectId,
            timestamp: event.timestamp.toISOString(),
          },
          actions: urlActions.map((action) => ({
            label: action.label,
            url: action.url,
          })),
        };
        const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
        execFile(macAppExecutable(options.mac.appPath), ["--notify-base64", encoded], (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else if (backend === "terminal-notifier") {
        const args = ["-title", title, "-message", options.fallbackMessage ?? message];
        if (options.openUrl) {
          args.push("-open", options.openUrl);
        }
        if (options.sound) {
          args.push("-sound", "default");
        }
        execFile("terminal-notifier", args, (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        const safeTitle = escapeAppleScript(title);
        const safeMessage = escapeAppleScript(options.fallbackMessage ?? message);
        const soundClause = options.sound ? ' sound name "default"' : "";
        const script = `display notification "${safeMessage}" with title "${safeTitle}"${soundClause}`;
        execFile("osascript", ["-e", script], (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    } else if (os === "linux") {
      // Linux urgency is driven by event priority, not the macOS sound config
      const args: string[] = [];
      if (options.isUrgent) {
        args.push("--urgency=critical");
      }
      args.push(title, options.fallbackMessage ?? message);
      execFile("notify-send", args, (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      console.warn(`[notifier-desktop] Desktop notifications not supported on ${os}`);
      resolve();
    }
  });
}

export function create(config?: Record<string, unknown>): Notifier {
  const soundEnabled = typeof config?.sound === "boolean" ? config.sound : true;
  const dashboardUrl = typeof config?.dashboardUrl === "string" ? config.dashboardUrl : undefined;
  const backend = parseBackend(config?.backend);
  const appPath = typeof config?.appPath === "string" ? config.appPath : defaultMacAppPath();
  const hasTerminalNotifier =
    platform() === "darwin" && (backend === "auto" || backend === "terminal-notifier")
      ? detectTerminalNotifier()
      : false;
  const mac = {
    backend,
    appPath,
    useTerminalNotifier: hasTerminalNotifier,
  };

  return {
    name: "desktop",

    async notify(event: OrchestratorEvent): Promise<void> {
      const title = formatTitle(event);
      const message = formatMessage(event);
      const sound = shouldPlaySound(event.priority, soundEnabled);
      const isUrgent = event.priority === "urgent";
      await sendNotification(title, message, event, {
        sound,
        isUrgent,
        mac,
        openUrl: dashboardUrl,
      });
    },

    async notifyWithActions(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void> {
      const title = formatTitle(event);
      const nonUrlActions = actions.filter((action) => typeof action.url !== "string");
      const message =
        backend === "ao-app" || (backend === "auto" && detectAoNotifierApp(appPath))
          ? nonUrlActions.length > 0
            ? formatActionsMessage(event, nonUrlActions)
            : formatMessage(event)
          : formatActionsMessage(event, actions);
      const sound = shouldPlaySound(event.priority, soundEnabled);
      const isUrgent = event.priority === "urgent";
      await sendNotification(title, message, event, {
        sound,
        isUrgent,
        mac,
        openUrl: dashboardUrl,
        actions,
        fallbackMessage: formatActionsMessage(event, actions),
      });
    },
  };
}

export default { manifest, create } satisfies PluginModule<Notifier>;
