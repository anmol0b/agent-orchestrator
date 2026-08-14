// Agent TUIs (codex, claude-code) keep their whole transcript in their own
// memory and repaint it on every resize, so a terminal-level Clear — which
// empties xterm's buffer and the runtime's scrollback — can never keep those
// panes empty. Clearing what the user actually sees requires the TUI's own
// conversation-reset command, typed through the pane like human input.
//
// Only providers whose command has been verified against the installed CLI are
// listed; every other provider hides the "Clear conversation" action
// (clearConversationCommand returns undefined). Mirrors the capability-set
// pattern of KEYBOARD_SCROLL_PROVIDERS in TerminalPane.tsx.

// claude-code: /clear — "Clear conversation history and free up context".
// codex: /clear — clears the TUI's conversation thread (codex /clear command).
const CLEAR_CONVERSATION_COMMANDS: Record<string, string> = {
	"claude-code": "/clear",
	codex: "/clear",
};

/**
 * The TUI command that resets the provider's conversation, or undefined when
 * the provider is unknown/unsupported. Destructive: it clears the agent's
 * conversation context too, so callers must confirm before sending.
 */
export function clearConversationCommand(provider?: string): string | undefined {
	if (!provider) return undefined;
	return CLEAR_CONVERSATION_COMMANDS[provider];
}
