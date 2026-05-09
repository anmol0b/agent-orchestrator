# Canvases

Canvases are interactive artifacts rendered next to the terminal in the session detail view. Instead of scrolling through terminal scrollback to find a diff, a test summary, or PR status, agents and plugins emit structured artifacts that the dashboard renders as standalone panels.

This is AO's answer to Cursor's [canvases](https://cursor.com/docs/agent/tools/canvas), shaped for an open-source plugin ecosystem.

## Design principles

1. **Two layers of extensibility.** v0.1 ships a fixed set of 4 renderer types — agents drop JSON, the dashboard renders it, no permission needed. v0.4 adds a **canvas-renderer plugin slot** so anyone can ship a new type as `@aoagents/ao-plugin-canvas-{name}`. Trust boundary is `npm install` — the same trust boundary as every other AO plugin.
2. **No remote-loaded JS at runtime.** Renderer plugins are discovered at AO startup and bundled at web build time. The dashboard never fetches code from URLs, never executes agent-emitted React. **But be honest:** an installed renderer plugin is arbitrary dashboard code — it can read same-origin auth tokens and call same-origin APIs. Build-time bundling removes the remote-code-loading risk; it does not reduce blast radius. **Installing a canvas renderer plugin grants full dashboard code execution.** v0.4 docs and install warnings will say that explicitly.
3. **Workspace is the source of truth.** Agents write canvases to `{workspacePath}/.ao/canvases/{id}.json` — same pattern as `activity.jsonl`. Core reads, validates, size-caps, and exposes through the dashboard API. The dashboard never reads agent files directly.
4. **Pull, then push.** v0.1 polls a REST endpoint on the session detail page. Live updates ride on the existing mux WebSocket later — no new SSE channel.
5. **Runtime registries, not extensible types.** The `CanvasArtifact` discriminated union for built-in types stays closed and strictly typed. Plugin canvases land in a separate `PluginCanvasArtifact { type: string; payload: unknown }` branch. Three registries — generated from one discovery step — drive the system: a Node schema registry (core uses to validate), a generated web renderer map (next bundles statically), and an optional generated TS union (web/internal ergonomics). TypeScript union extension is a convenience layer, not the architecture.

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

### Tier 3 — Renderer plugin (v0.4, ~half a day for plugin author / 1.5–3 engineer-weeks of core platform work)

Ship a new canvas type as `@aoagents/ao-plugin-canvas-{name}`. The plugin author publishes a compiled package; AO discovers it at startup, validates payloads through the plugin's Zod schema in core (Node), and bundles the renderer into the dashboard at web build time. **No core PR needed.**

#### Package shape

Plugin authors publish **compiled ESM** with declarations — not raw TSX. Renderer must be browser-safe (no Node APIs, React as `peerDependency`). Schema entrypoint must be Node-safe.

```
@aoagents/ao-plugin-canvas-flamegraph/
├── package.json                    # exports: { ".": ..., "./renderer": ... }
├── dist/
│   ├── index.js                    # manifest + Zod payload schema (Node)
│   └── renderer.js                 # React component, default export (browser)
```

```json
// package.json
{
  "name": "@aoagents/ao-plugin-canvas-flamegraph",
  "exports": {
    ".":         "./dist/index.js",
    "./renderer": "./dist/renderer.js"
  },
  "peerDependencies": { "react": "^19" }
}
```

```typescript
// dist/index.js (Node-safe)
import { z } from "zod";
export const manifest = {
  name: "flamegraph",
  slot: "canvas-renderer" as const,
  canvasType: "flamegraph",
  version: "0.1.0",
};
export const payloadSchema = z.object({
  samples: z.array(z.object({ name: z.string(), value: z.number() })).max(10_000),
  unit: z.enum(["ms", "samples"]),
});
```

#### How AO wires it together

One discovery step produces three artifacts:

```
plugin discovery
  → Node schema registry        (core uses to validate at runtime)
  → generated web renderer map  (next bundles statically)
  → optional generated TS union (web/internal ergonomics only)
```

1. **Discovery (AO startup, Node).** Plugin registry walks installed `@aoagents/ao-plugin-canvas-*` packages, loads each manifest + `payloadSchema`. Detects type-id collisions; refuses to start on conflict.
2. **Schema registry (runtime, Node).** `canvas-log.ts` receives a `CanvasSchemaRegistry`. Built-ins validate via the closed `CanvasArtifactSchema`; plugin canvases validate via `type → payloadSchema` lookup. Unknown type → rejected.
3. **Generated web renderer map (build time).** A generator writes `packages/web/src/generated/canvas-renderers.ts` with **static imports** of each plugin's `/renderer` entrypoint:
   ```typescript
   import FlamegraphRenderer from "@aoagents/ao-plugin-canvas-flamegraph/renderer";
   export const canvasPluginRenderers: Record<string, React.ComponentType<{ canvas: PluginCanvasArtifact }>> = {
     flamegraph: FlamegraphRenderer,
   };
   ```
   Next.js can't bundle dynamic plugin paths — only static imports. The barrel file gives Next a clean import graph.
4. **Renderer dispatch (runtime, browser).** `CanvasRail`'s switch handles built-in types as today. The `default` branch looks up `canvasPluginRenderers[canvas.type]`. Missing entry → "Unsupported canvas type" placeholder. Renderer crash → caught by an error boundary, doesn't take down the rail.

#### Type model

Core types stay strict for built-ins, with a single fallback for plugin types:

```typescript
type BuiltInCanvasArtifact =
  | { type: "markdown"; payload: { markdown: string }; ... }
  | { type: "diff"; payload: { files: CanvasDiffFile[] }; ... }
  | { type: "table"; payload: { ... }; ... }
  | { type: "stats"; payload: { ... }; ... };

type PluginCanvasArtifact = {
  id: string;
  type: string;       // any canvasType registered by a plugin
  title: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
  payload: unknown;   // plugin's Zod schema validates in core before serving
};

type CanvasArtifact = BuiltInCanvasArtifact | PluginCanvasArtifact;
```

Any API boundary that switches exhaustively on `canvas.type` must add an `unknown / plugin` branch.

#### Trust model — be specific

This is **not** the same trust as a tracker plugin or notifier plugin. A canvas renderer is arbitrary dashboard code:

- It can read same-origin storage (auth tokens, session cookies accessible to JS).
- It can call same-origin APIs as the user.
- It can keylog within the app.
- It can alter dashboard UI state.

Build-time bundling removes the **remote-code-loading** risk. It does **not** reduce blast radius. The trust check is `npm install`: someone you trust reviewed it once, and its code lives in your `node_modules`. **Installing a canvas renderer plugin grants full dashboard code execution.** v0.4 install path will surface this as a warning.

Iframe sandboxing is a credible future option for community/untrusted renderers but is deferred — half-baked iframe support is worse than no sandbox. Build the registries first; design the sandbox protocol when there's a concrete need.

### Tier 4 — Promote into core (rare, when ecosystem has converged)

Once a renderer plugin has multiple production callers and the type is genuinely general, propose promoting it into core's built-in set via PR. This is the path that requires reviewer scrutiny — the bar is "this is now standard infrastructure", not "this is a new idea worth trying".

## Roadmap

- **v0.1 (shipped)** — file reader, `GET /api/sessions/[id]/canvases`, four built-in renderers, `core.git-diff` synthesized canvas, right-rail in `SessionDetail` **desktop only** (auto-expands when canvases exist), 5s REST poll with visibility-aware pause.
- **v0.2** — `CanvasProducer` invoked on agent / SCM / tracker plugins (Tier 2 above).
- **v0.3** — mux topic for live updates, replacing poll.
- **v0.4 (1.5–3 engineer-weeks of core work)** — `canvas-renderer` plugin slot (Tier 3 above). Plugin discovery at AO startup, Node-side schema registry, generated `packages/web/src/generated/canvas-renderers.ts` barrel of static imports for the Next.js build, renderer dispatch path with error boundary, type-id collision detection, install-time trust warning, example flamegraph plugin, tests across core and web. Plugin authors publish compiled ESM with separate Node + browser entrypoints.
- **Mobile** — deferred. The rail is gated `!isMobile` in [`SessionDetail.tsx`](../packages/web/src/components/SessionDetail.tsx); below the mobile breakpoint the page falls back to its existing single-column layout. A proper mobile UI (bottom sheet or full-screen takeover) is a separate design pass.
- **Sandboxed iframe escape hatch** — credible future option for genuinely untrusted renderers. Deferred until v0.4 is live and there's a concrete need; half-baked iframe support is worse than no sandbox.

Out of scope indefinitely: **dynamically loaded** JS from URLs at runtime, agent-emitted React, remote-fetched renderer modules. v0.4 plugins are discovered at startup from `node_modules`, not from the network. Write APIs from the dashboard back into canvases. Action buttons that mutate session state.

## Canvas-id namespacing

Two separate concerns, often conflated:

- **`id`** — the filesystem identity of a canvas file (`{workspacePath}/.ao/canvases/{id}.json`) and its stable UI identity for animations / collapse state. Reserved prefix: **`core-`** for canvases synthesized by AO core (`core-git-diff`, etc). File canvases using `core-` are dropped by the reader.
- **`canvasType`** — the renderer dispatch key. Maps to a built-in renderer or a plugin renderer. **`canvasType` does not reserve `id`s.** A Claude agent can legitimately produce a `type: "flamegraph"` canvas with id `auth-perf-2026-05-06` without being the flamegraph plugin author. Producers and renderers are separate concerns.

Recommended (not enforced): plugins suggest a producer-scoped id prefix to avoid collision in the wild — e.g. flamegraph plugin's example agent emits `flamegraph-*` ids. Enforced: only `core-*` reservation and per-session id collision (last-writer-wins by `updatedAt`).
