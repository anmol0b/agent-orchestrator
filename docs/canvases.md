# Canvases

Canvases are interactive artifacts rendered next to the terminal in the session detail view. Instead of scrolling through terminal scrollback to find a diff, a test summary, or PR status, agents and plugins emit structured artifacts that the dashboard renders as standalone panels.

This is AO's answer to Cursor's [canvases](https://cursor.com/docs/agent/tools/canvas), shaped for an open-source plugin ecosystem.

## Design principles

1. **Two layers of extensibility.** v0.1 ships a fixed set of 4 renderer types — agents drop JSON, the dashboard renders it, no permission needed. v0.4 adds a **canvas-renderer plugin slot** so anyone can ship a new type as `@aoagents/ao-plugin-canvas-{name}` without a core PR. Trust boundary is `npm install` (the same trust boundary as every other AO plugin), not runtime code injection.
2. **No third-party JS at runtime.** Renderer plugins are bundled at build time, not loaded dynamically. The dashboard never executes code that wasn't in the install. This rules out remote code from agent JSON, but doesn't rule out community-shipped renderer types.
3. **Workspace is the source of truth.** Agents write canvases to `{workspacePath}/.ao/canvases/{id}.json` — same pattern as `activity.jsonl`. Core reads, validates, size-caps, and exposes through the dashboard API. The dashboard never reads agent files directly.
4. **Pull, then push.** v0.1 polls a REST endpoint on the session detail page. Live updates ride on the existing mux WebSocket later — no new SSE channel.

## Renderer types

Defined in [`packages/core/src/types.ts`](../packages/core/src/types.ts) as `CanvasArtifact`. Current set:

| Type | Use for | Payload shape |
|------|---------|---------------|
| `markdown` | Notes, summaries, READMEs, plain text reports | `{ markdown: string }` |
| `diff` | File changes, patches, reviews | `{ files: CanvasDiffFile[] }` |
| `table` | Test results, dependency lists, anything tabular | `{ columns, rows }` |
| `stats` | Cost, token counts, durations, pass/fail counts | `{ metrics: CanvasStatMetric[] }` |

If your data fits one of these, just emit JSON — Tier 1 in the [extension model](#extension-model). If it genuinely doesn't (flame graph, Gantt chart, network topology), ship a **renderer plugin** in v0.4 — Tier 3 below. Don't reach for the core PR path until a renderer plugin has multiple ecosystem callers and we want to promote it into the built-in set.

## Producing canvases

### From an agent (file-based)

Write a JSON file to `{workspacePath}/.ao/canvases/{id}.json` matching `CanvasArtifact`. Use a stable `id` if you want to overwrite the same canvas across runs; use a fresh `id` to append.

```json
{
  "version": 1,
  "id": "test-results",
  "type": "table",
  "title": "Test results",
  "createdAt": "2026-05-04T17:00:00Z",
  "updatedAt": "2026-05-04T17:00:00Z",
  "source": "agent",
  "payload": {
    "columns": [
      { "key": "name", "label": "Test" },
      { "key": "status", "label": "Status" },
      { "key": "duration_ms", "label": "Duration", "align": "right" }
    ],
    "rows": [
      { "name": "auth.test.ts", "status": "pass", "duration_ms": 142 },
      { "name": "billing.test.ts", "status": "fail", "duration_ms": 89 }
    ]
  }
}
```

The directory is gitignored and travels with the worktree.

### From a plugin (programmatic)

Implement `CanvasProducer` on any existing plugin (agent, SCM, tracker). Core calls `listCanvases` when the session detail view loads.

```ts
import type { CanvasProducer, CanvasArtifact, Session, ProjectConfig } from "@aoagents/ao-core";

const producer: CanvasProducer = {
  async listCanvases(session: Session, project: ProjectConfig): Promise<CanvasArtifact[]> {
    return [
      {
        version: 1,
        id: "pr-status",
        type: "stats",
        title: "PR status",
        createdAt: session.createdAt,
        updatedAt: new Date().toISOString(),
        source: "scm-github",
        payload: {
          metrics: [
            { label: "CI", value: "passing", tone: "good" },
            { label: "Reviews", value: 2 },
            { label: "Mergeable", value: "yes", tone: "good" },
          ],
        },
      },
    ];
  },
};
```

Returned artifacts are validated and size-capped by core before reaching the dashboard.

## Validation rules

Canvases that fail validation are dropped silently and logged. Rules:

- `version` must be `1`.
- `type` must be a known `CanvasType`.
- `id` must be `[a-z0-9-]{1,64}`.
- The `core-` id prefix is reserved for canvases synthesized by AO core (e.g. `core-git-diff`). File canvases using this prefix are dropped — pick a different id.
- Total serialized size capped at 256 KB per canvas.
- Per-session count capped at 32 canvases (oldest by `updatedAt` evicted).
- Payload must structurally match the type.

## Storage layout

```
{workspacePath}/.ao/canvases/
  test-results.json
  diff-summary.json
```

Synthesized canvases (PR, CI, cost) are computed on read and not persisted. If a canvas needs to survive workspace cleanup, persist it via the session metadata directory in core — not from the producer.

## Extension model

Three tiers of effort, smallest first.

### Tier 1 — Emit JSON (today, ~3 minutes)

Drop a file at `{workspacePath}/.ao/canvases/{id}.json` matching one of the 4 built-in schemas. The dashboard polls every 5s and renders it. No code change in AO. This is what 90% of agents will do.

### Tier 2 — `CanvasProducer` plugin (v0.2, ~30 lines)

Synthesize canvases programmatically from session data. Implement `CanvasProducer.listCanvases` on an existing `agent` / `scm` / `tracker` plugin. The interface lives in [`types.ts`](../packages/core/src/types.ts). v0.1 declares it; v0.2 invokes it from the canvases API endpoint.

### Tier 3 — Renderer plugin (v0.4, ~half day)

Ship a new canvas type as `@aoagents/ao-plugin-canvas-{name}`. Same trust boundary as every other AO plugin: you `npm install` it, AO bundles the renderer into the dashboard at build time. **No core PR needed.** No runtime code execution from arbitrary sources.

Sketch of the plugin shape (subject to refinement during v0.4 design):

```
@aoagents/ao-plugin-canvas-flamegraph/
├── package.json                    # name: @aoagents/ao-plugin-canvas-flamegraph
├── src/
│   ├── index.ts                    # manifest + payload schema (Zod)
│   └── renderer.tsx                # React component, default export
```

```typescript
// packages/plugins/canvas-flamegraph/src/index.ts
import { z } from "zod";
export const manifest = {
  name: "flamegraph",
  slot: "canvas-renderer" as const,
  canvasType: "flamegraph",        // the new CanvasType discriminator
  version: "0.1.0",
};
export const payloadSchema = z.object({
  samples: z.array(z.object({ name: z.string(), value: z.number() })).max(10_000),
  unit: z.enum(["ms", "samples"]),
});
```

At AO build time the plugin registry walks installed `@aoagents/ao-plugin-canvas-*` packages, generates a TypeScript file that imports each renderer plus extends the `CanvasArtifact` discriminated union, and the web build bundles them. The dashboard's `CanvasRail` switch-on-type dispatches to the plugin's renderer for unknown built-in types.

Trust model: same as adding any plugin — you reviewed it before installing, and its code lives in your `node_modules`. No remote loading, no runtime injection. If you don't trust a plugin, don't install it; this is the npm trust chain, not a sandbox.

### Tier 4 — Promote into core (rare, when ecosystem has converged)

Once a renderer plugin has multiple production callers and the type is genuinely general, propose promoting it into core's built-in set via PR. This is the path that requires reviewer scrutiny — the bar is "this is now standard infrastructure", not "this is a new idea worth trying".

## Roadmap

- **v0.1 (shipped)** — file reader, `GET /api/sessions/[id]/canvases`, four built-in renderers, `core.git-diff` synthesized canvas, right-rail in `SessionDetail` **desktop only** (auto-expands when canvases exist), 5s REST poll with visibility-aware pause.
- **v0.2** — `CanvasProducer` invoked on agent / SCM / tracker plugins (Tier 2 above).
- **v0.3** — mux topic for live updates, replacing poll.
- **v0.4** — `canvas-renderer` plugin slot (Tier 3 above). Build-time bundling of `@aoagents/ao-plugin-canvas-*` packages, dynamic discriminated-union extension, type-id collision detection at registry load.
- **Mobile** — deferred. The rail is gated `!isMobile` in [`SessionDetail.tsx`](../packages/web/src/components/SessionDetail.tsx); below the mobile breakpoint the page falls back to its existing single-column layout. A proper mobile UI (bottom sheet or full-screen takeover) is a separate design pass.
- **Sandboxed iframe escape hatch** — only if a real use case (e.g. third-party HTML emitted by an agent that we genuinely cannot trust) shows up. Adds runtime isolation cost but trades it for unlimited content flexibility.

Out of scope indefinitely: **dynamically loaded** React from third-party sources at runtime (URL-injected, agent-emitted, etc.) — only build-time bundled plugins. Write APIs from the dashboard back into canvases. Action buttons that mutate session state.
