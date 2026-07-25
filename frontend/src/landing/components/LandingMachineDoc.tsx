import type { ReactNode } from "react";

/*
 * MACHINE mode — a raw, agent-parseable spec of AO, modeled on llms.txt and
 * parallel.ai/.md. Rendered as literal markdown source: headings keep their
 * `#` markers and links keep `[label](url)` syntax (the full bracketed form
 * is the clickable anchor). No marketing copy in this document.
 */

const DOC = `# Agent Orchestrator (AO)

Mission control for a fleet of coding agents. AO runs 23 agent harnesses in isolated git worktrees, watches every PR, and routes CI and review feedback back to the agent that owns the branch.

Install: brew install --cask agentwrapper/tap/agent-orchestrator

## Facts

- license: Apache-2.0
- platforms: macOS (arm64, x64), Windows (x64), Linux (x64 AppImage)
- runtime: local only — no account, no cloud
- state: SQLite + files under ~/.ao
- releases: nightly builds daily; stable tags on GitHub

## Architecture

- Local Go daemon. HTTP + SSE API bound to 127.0.0.1 (loopback only, unauthenticated).
- IPC transport: loopback HTTP; live updates via Server-Sent Events emitted from SQLite change_log triggers.
- The desktop app (Electron) and the ao CLI are thin clients over the daemon HTTP API. No logic in the clients.
- Auth: gh auth login. AO reads issues, PRs, checks, and reviews as you. No AO-issued tokens.
- No hosted control plane. There is no AO server to connect to and nothing phones home.
- Each worker session: one git worktree + one runtime (tmux or process) + one agent CLI.
- The SCM observer polls PR facts via gh; reactions route failed checks and review comments back to the session that owns the branch.

## Supported harnesses (23)

aider, agy, amp, auggie, autohand, claude-code, cline, codex, continue, copilot, crush, cursor, devin, droid, goose, grok, kilocode, kimi, kiro, opencode, pi, qwen, vibe

## Quickstart

$ brew install --cask agentwrapper/tap/agent-orchestrator
$ gh auth login
$ cd ~/code/my-repo && ao start

## Links

- [Docs](https://aoagents.dev/docs/)
- [Quickstart](https://aoagents.dev/docs/quickstart/)
- [Installation](https://aoagents.dev/docs/installation/)
- [CLI reference](https://aoagents.dev/docs/cli/)
- [Configuration](https://aoagents.dev/docs/configuration/)
- [Architecture](https://aoagents.dev/docs/architecture/)
- [Plugins](https://aoagents.dev/docs/plugins/)
- [Dashboard](https://aoagents.dev/docs/dashboard/)
- [Changelog](https://aoagents.dev/changelog/)
- [GitHub repo](https://github.com/AgentWrapper/agent-orchestrator)
- [Releases](https://github.com/AgentWrapper/agent-orchestrator/releases)
- [Issues](https://github.com/AgentWrapper/agent-orchestrator/issues)
- [Discord](https://discord.com/invite/UZv7JjxbwG)
- [Human mode](https://aoagents.dev/)
`;

const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Render the doc literally, turning each [label](url) into one anchor whose
 *  visible text is the untouched markdown source. */
function renderMarkdownSource(source: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let lastIndex = 0;
	let key = 0;
	for (const match of source.matchAll(LINK_RE)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			nodes.push(source.slice(lastIndex, index));
		}
		const [, label, url] = match;
		nodes.push(
			<a
				key={`link-${key++}`}
				href={url}
				className="underline decoration-[color:var(--border-strong)] underline-offset-4 transition-colors hover:text-[color:var(--fg)] hover:decoration-[color:var(--fg-muted)]"
			>
				{match[0]}
			</a>,
		);
		lastIndex = index + match[0].length;
	}
	if (lastIndex < source.length) {
		nodes.push(source.slice(lastIndex));
	}
	return nodes;
}

export function LandingMachineDoc() {
	return (
		<div data-testid="machine-doc" className="min-h-screen bg-[#0a0b0d] text-[#9ba1aa]">
			<main className="mx-auto max-w-[780px] px-5 pb-24 pt-24 sm:px-8">
				<pre className="whitespace-pre-wrap font-mono text-[13px] leading-[1.75]">
					{renderMarkdownSource(DOC)}
				</pre>
			</main>
		</div>
	);
}
