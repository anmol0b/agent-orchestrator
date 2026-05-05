# Canvases

Canvases are interactive artifacts rendered next to the terminal in the session detail view. Instead of scrolling through terminal scrollback to find a diff, a test summary, or PR status, agents and plugins emit structured artifacts that the dashboard renders as standalone panels.

This is AO's answer to Cursor's [canvases](https://cursor.com/docs/agent/tools/canvas), shaped for an open-source plugin ecosystem.

## Design principles

1. **Expressive data, constrained UI.** Producers supply data in one of a fixed set of renderer types. They do not ship React components. This keeps the dashboard install one-step, avoids running third-party JS in the supervisor, and keeps the rendered surface consistent across every AO instance.
2. **No new plugin slot.** Canvases are session output, not infrastructure. Existing plugins (agent, SCM, tracker) opt in by implementing `CanvasProducer`. Core also synthesizes canvases from PR / CI / git data so the feature works without per-agent integration.
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

If your data doesn't fit, **shape it to fit one of these** before reaching for a new type. A "test results" canvas is a `table`. A "deployment status" canvas is `stats` plus `markdown`. Adding a new renderer type requires a core PR — propose it as an issue first with at least two real use cases.

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

## Roadmap

- **v0.1 (shipped)** — file reader, `GET /api/sessions/[id]/canvases`, four built-in renderers, `core.git-diff` synthesized canvas, right-rail in `SessionDetail` (auto-expands when canvases exist), 5s REST poll with visibility-aware pause.
- **v0.2** — `CanvasProducer` invoked on agent / SCM / tracker plugins.
- **v0.3** — mux topic for live updates, replacing poll.
- **Later, only if justified** — sandboxed iframe escape hatch for custom UI, build-time allowlisted renderer packages.

Out of scope indefinitely: dynamic React imports from third-party plugins, write APIs from the dashboard back into canvases, action buttons that mutate session state.
