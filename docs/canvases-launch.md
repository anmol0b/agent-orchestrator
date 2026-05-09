# Canvases — what shipped, why it matters

> *Cursor-style interactive artifacts in the AO session detail view.* PR [#1653](https://github.com/ComposioHQ/agent-orchestrator/pull/1653)

## The pitch

When an agent emits a diff, a test summary, a cost breakdown, or any other structured output, today it scrolls past in the terminal and you lose it. Canvases give every session a right-hand rail where structured output **stays visible, stays interactive, and stays readable**.

Two ways to fill the rail:

1. **Free of charge** — AO synthesizes a `core-git-diff` canvas from the session's worktree against `origin/<default>`. Every session gets this without any agent integration.
2. **Agents opt in** — drop a JSON file at `{workspacePath}/.ao/canvases/{id}.json`. The dashboard picks it up within 5 seconds. No new SDK, no new APIs to call.

![Two canvases rendered in the rail next to the terminal — a markdown summary and a stats grid with green/red/amber tone colors](assets/canvases/canvases-hero.png)

## Try it locally in 30 seconds

```bash
# 1. Start the dashboard
pnpm dev

# 2. Open any session detail page in your browser

# 3. From a terminal, drop a JSON file in the session's worktree
WS=$(jq -r .worktree ~/.agent-orchestrator/projects/<your-project>/sessions/<session-id>.json)
mkdir -p "$WS/.ao/canvases"
cat > "$WS/.ao/canvases/hello.json" <<'EOF'
{
  "version": 1,
  "id": "hello",
  "type": "stats",
  "title": "Demo",
  "createdAt": "2026-05-05T00:00:00Z",
  "updatedAt": "2026-05-05T00:00:00Z",
  "payload": {
    "metrics": [
      { "label": "Tests", "value": 42, "tone": "good" },
      { "label": "Failures", "value": 0, "tone": "neutral" }
    ]
  }
}
EOF
```

Within 5 seconds the canvas appears. Edit the file, save, watch it update.

## What renders

Four built-in types, no plugins required:

| Type | What it's for | Payload shape |
|---|---|---|
| `markdown` | Notes, summaries, READMEs | `{ markdown: string }` — supports headings, **bold**, *italic*, `code`, fenced code blocks, lists |
| `diff` | File changes, patches | `{ files: [{ path, status, hunks }] }` |
| `table` | Test results, dependency lists | `{ columns, rows }` |
| `stats` | Cost, durations, pass/fail counts | `{ metrics: [{ label, value, tone, delta }] }` |

The `tone` field on `stats` maps to AO's existing status tokens — `good` is green, `bad` is red, `warn` is amber, `neutral` matches the surrounding text. No new design tokens.

## Empty state when there's nothing to show

The rail starts collapsed when a session has no canvases. A thin tab on the right edge expands it on click.

![Collapsed and expanded states of the canvas rail](assets/canvases/canvases-empty.png)

## Mobile: not supported in v0.1

Canvases are a desktop-only feature for now. On viewports below the mobile breakpoint the rail isn't rendered at all — the session detail page falls back to its existing single-column layout. We'll revisit a proper mobile experience (likely a bottom sheet or full-screen takeover) once the desktop surface settles.

## How to extend it

Three tiers of effort, smallest first.

### Tier 1 — Zero code: emit JSON

Write a file matching one of the 4 schemas to `{workspacePath}/.ao/canvases/{id}.json`. The dashboard polls every 5s and renders it. This is what 90% of agents will do.

Examples that fit today with no extra work:

- **Test runner agent** → `table` with name / status / duration columns
- **Codex review agent** → `markdown` with the structured findings
- **Cost tracker** → `stats` with token counts, request count, dollar estimates
- **Lint runner** → `table` with file / rule / message columns
- **Security scanner** → `markdown` with severity-grouped findings
- **Build dashboard** → `stats` with build time, bundle size, asset count

### Tier 2 — A producer plugin (v0.2, queued)

If you want to *synthesize* canvases from session data instead of having an agent emit them, implement `CanvasProducer` on an existing plugin. The interface already exists in core:

```ts
interface CanvasProducer {
  listCanvases(session: Session, project: ProjectConfig): Promise<CanvasArtifact[]>;
}
```

This is what a future `scm-github` plugin would do to surface a "PR status" stats canvas, or what a `tracker-linear` plugin would do for "linked issues" tables. v0.1 declares the interface but doesn't invoke it yet — once v0.2 lands, every plugin slot (agent / SCM / tracker) gets called automatically when the API loads canvases.

Effort: ~30 lines per producer. No dashboard changes, no schema changes, no PR review of UI code.

### Tier 3 — Renderer plugin (v0.4, ~half a day for plugin author / 1.5–3 engineer-weeks of core platform work)

Ship a new canvas type as `@aoagents/ao-plugin-canvas-{name}`. The plugin author publishes a compiled package with two entrypoints — a Node-safe schema and a browser-safe React renderer. AO discovers plugins at startup, validates payloads through the plugin's Zod schema, and bundles the renderer into the dashboard at web build time.

**No core PR needed** — the bar to publish a plugin is `npm install`-able.

Sketch:

```
@aoagents/ao-plugin-canvas-flamegraph/
├── package.json          # exports: { ".": "./dist/index.js", "./renderer": "./dist/renderer.js" }
├── dist/
│   ├── index.js          # manifest + Zod payload schema (Node)
│   └── renderer.js       # React component, default export (browser)
```

The pipeline:

```
plugin discovery (at AO startup)
  → Node schema registry        (core uses to validate canvas JSON)
  → generated web renderer map  (next bundles statically — packages/web/src/generated/canvas-renderers.ts)
  → optional generated TS union (web/internal ergonomics only)
```

The `CanvasArtifact` discriminated union for built-in types stays closed. Plugin canvases land in a separate `PluginCanvasArtifact { type: string; payload: unknown }` branch. Runtime registries are the architecture; types are convenience.

v0.1 ships the 4 built-in types. v0.4 (queued — 1.5–3 engineer-weeks of core work) ships the plugin slot. Until then, if you genuinely need a new type, either reshape your data into an existing renderer or contribute the type to core.

### Tier 4 — Promote into core (rare)

Once a renderer plugin has multiple production callers and the type is genuinely general (not specific to your stack), propose promoting it into core's built-in set via PR. The bar here is "this is standard infrastructure now", not "this is a new idea worth trying".

### The contract — and the honest trust statement

Three rules that hold across all four tiers:

- **Anyone supplies any data, in any supported type** — no permission needed.
- **Anyone ships a new type via plugin** — `npm install` is the trust gate.
- **No remote-loaded JS at runtime** — plugins discovered at startup from `node_modules`, renderers bundled at web build time. No URL-fetched code, no agent-emitted React.

**Be honest about what `npm install` trust means here.** A canvas renderer plugin is arbitrary dashboard code: it can read same-origin auth tokens, call same-origin APIs, keylog within the app, alter UI state. Build-time bundling removes the **remote-loading** risk; it does not reduce blast radius. **Installing a canvas renderer plugin grants full dashboard code execution** — the install path will surface this as a warning. Iframe sandboxing is a deferred future option for community/untrusted renderers.

## What's deliberately *not* in v0.1

- Custom React renderers from third-party plugins (security boundary; never planned)
- Plugin-invoked `CanvasProducer.listCanvases` calls (queued for v0.2)
- Mux WebSocket push (queued for v0.3 — currently 5s REST poll)
- Write APIs from the dashboard back into canvases
- Action buttons that mutate session state

## Built with paranoia

The feature went through 12 codex review passes that surfaced 18 distinct corner-case bugs before merge:

- Polynomial-backtracking regex (CodeQL `js/redos`) replaced with `lastIndexOf`
- `lstat` instead of `stat` so a symlink to `/dev/zero` can't bypass the size cap
- Reserved `core-` id prefix so an agent can't shadow the trusted synthesized canvas
- Per-effect cancellation + sequence-guarded poll responses so an old response can't overwrite a newer one
- `.ao/` filtered out of synthesized diffs so AO's own metadata doesn't leak into agent diffs
- Untracked-file synthesis with file count + byte budget caps so a workspace with thousands of build artifacts can't make every poll slow
- `origin/<base>` preferred over stale local refs for merge-base
- Partial-stdout recovery so oversized diffs truncate instead of disappearing

End-to-end QA verified all paths in a real browser (full report in `.gstack/qa-reports/qa-report-canvases-2026-05-05.md` if you want to see the screenshots and per-test evidence).

## Where to read more

- [docs/canvases.md](canvases.md) — full design doc, schema, validation rules, producer guides, roadmap
- [PR #1653](https://github.com/ComposioHQ/agent-orchestrator/pull/1653) — implementation
- [packages/core/src/types.ts](../packages/core/src/types.ts) — `CanvasArtifact`, `CanvasProducer`, supporting types
- [packages/core/src/canvas-log.ts](../packages/core/src/canvas-log.ts) — file reader + git-diff synthesizer
- [packages/web/src/components/CanvasRail.tsx](../packages/web/src/components/CanvasRail.tsx) — the right-rail component

