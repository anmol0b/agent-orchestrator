/**
 * Pipeline service — pure adapters between the CLI and the v0.1/v0.2 pipeline
 * core (config schema + flat-file store + reducer).
 *
 * Each function takes its dependencies as arguments so the CLI command tests
 * can inject a mocked store / config and assert on store interactions
 * (per the v0.3 acceptance criterion).
 *
 * The service intentionally does NOT depend on the `engine.ts` orchestrator
 * loop: `ao pipeline run` allocates IDs and persists initial run state, but
 * driving stages forward (spawning sessions, polling) is the running
 * orchestrator's job in a later sub-task. This keeps the CLI usable
 * stand-alone for inspection and idempotent for triggers.
 */

import { randomUUID } from "node:crypto";
import {
  asPipelineId,
  asRunId,
  asStageRunId,
  configuredPipelineToRuntime,
  emptyEngineState,
  reduce,
  validatePipelineAgentModes,
  type Artifact,
  type ConfiguredPipeline,
  type EngineState,
  type LoopState,
  type OrchestratorConfig,
  type PersistedStageRun,
  type Pipeline,
  type PipelineEffect,
  type PipelineEvent,
  type PipelineStore,
  type PluginRegistry,
  type RunId,
  type RunState,
  type StageRunId,
  type StageState,
  type StageStatus,
} from "@aoagents/ao-core";

/** Lightweight summary used by `ao pipeline list`. */
export interface ConfiguredPipelineSummary {
  pipelineId: string;
  name: string;
  stageCount: number;
  triggers: string[];
}

export interface RunFilter {
  pipeline?: string;
  status?: string;
}

export type RunStatusLabel =
  | "running"
  | "awaiting_context"
  | "done"
  | "stalled"
  | "terminated";

/** All pipelines configured for a project (`projects.<id>.pipelines`). */
export function listConfiguredPipelines(
  config: OrchestratorConfig,
  projectId: string,
): ConfiguredPipelineSummary[] {
  const project = config.projects[projectId];
  if (!project?.pipelines) return [];

  return Object.entries(project.pipelines).map(([key, configured]) => {
    const triggers = collectTriggers(configured);
    return {
      pipelineId: asPipelineId(key),
      name: configured.name ?? key,
      stageCount: configured.stages.length,
      triggers,
    };
  });
}

function collectTriggers(configured: ConfiguredPipeline): string[] {
  const seen = new Set<string>();
  for (const stage of configured.stages) {
    for (const event of stage.trigger.on) {
      seen.add(event);
    }
  }
  return [...seen].sort();
}

/** Resolve a pipeline by name (case-sensitive map key). */
export function resolveConfiguredPipeline(
  config: OrchestratorConfig,
  projectId: string,
  pipelineName: string,
): Pipeline {
  const project = config.projects[projectId];
  const configured = project?.pipelines?.[pipelineName];
  if (!configured) {
    throw new Error(
      `Pipeline "${pipelineName}" is not configured for project "${projectId}".`,
    );
  }
  return configuredPipelineToRuntime(pipelineName, configured);
}

/** Filtered, newest-first list of runs for `ao pipeline runs`. */
export function listRuns(store: PipelineStore, filter: RunFilter = {}): RunState[] {
  const runs = store.listRuns();
  const filtered = runs.filter((run) => {
    if (filter.pipeline && run.pipelineName !== filter.pipeline) return false;
    if (filter.status && run.loopState !== filter.status) return false;
    return true;
  });
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface StageWithArtifacts {
  stageName: string;
  state: StageState;
  artifacts: Artifact[];
}

export interface RunDetail {
  run: RunState;
  loop: LoopState | null;
  stages: StageWithArtifacts[];
}

export function describeRun(store: PipelineStore, runId: RunId): RunDetail {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const loop = store.loadLoopState(runId);
  const stages: StageWithArtifacts[] = Object.entries(run.stages).map(
    ([stageName, stageState]) => ({
      stageName,
      state: stageState,
      artifacts: store.listArtifacts(runId, stageState.stageRunId),
    }),
  );

  return { run, loop, stages };
}

/** Resolved stage detail used by `ao stage show`. */
export interface StageDetail {
  stage: PersistedStageRun;
  run: RunState | null;
  artifacts: Artifact[];
}

export function describeStage(
  store: PipelineStore,
  stageRunId: StageRunId,
): StageDetail {
  const stage = store.loadStage(stageRunId);
  if (!stage) throw new Error(`Stage not found: ${stageRunId}`);

  const run = store.loadRun(stage.runId);
  const artifacts = store.listArtifacts(stage.runId, stageRunId);
  return { stage, run, artifacts };
}

/** Read-only artifact list used by `ao artifact show <stageRunId>`. */
export function readStageArtifacts(
  store: PipelineStore,
  stageRunId: StageRunId,
): Artifact[] {
  const stage = store.loadStage(stageRunId);
  if (!stage) throw new Error(`Stage not found: ${stageRunId}`);
  return store.listArtifacts(stage.runId, stageRunId);
}

/**
 * Trigger a manual run for a pipeline. The reducer dispatches TRIGGER_FIRED;
 * effects are persisted via the store. The CLI returns the allocated run id;
 * the running orchestrator (when present) drives the run forward via tick().
 *
 * `sessionId` defaults to `pipeline.<name>` so a CLI-triggered run can be
 * looked up by name without a worker session attached. Callers that already
 * have a session (e.g. lifecycle integration in v0.4) should override it.
 */
export interface TriggerOptions {
  sessionId?: string;
  headSha?: string;
}

export function triggerRun(
  store: PipelineStore,
  registry: PluginRegistry,
  pipeline: Pipeline,
  options: TriggerOptions = {},
  now: () => number = Date.now,
): RunId {
  validatePipelineAgentModes(pipeline, registry);

  const runId = asRunId(`run-${randomUUID()}`);
  const stageRunIds: Record<string, StageRunId> = {};
  for (const stage of pipeline.stages) {
    stageRunIds[stage.name] = asStageRunId(`sr-${randomUUID()}`);
  }

  applyEvent(store, emptyEngineState(), {
    type: "TRIGGER_FIRED",
    now: now(),
    trigger: "manual",
    sessionId: options.sessionId ?? `pipeline.${pipeline.name}`,
    pipeline,
    headSha: options.headSha ?? "manual",
    runId,
    stageRunIds,
  });

  return runId;
}

/**
 * Cancel an in-flight run. Loads the run state from the store, dispatches
 * RUN_CANCELLED through the reducer, and persists effects. Idempotent:
 * cancelling a terminal run is a no-op.
 */
export function cancelRun(
  store: PipelineStore,
  runId: RunId,
  now: () => number = Date.now,
): RunState {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  if (
    run.loopState === "done" ||
    run.loopState === "stalled" ||
    run.loopState === "terminated"
  ) {
    return run;
  }

  const initialState: EngineState = {
    runs: { [runId]: run },
    currentRunByLoop: { [`${run.sessionId}:${run.pipelineName}`]: runId },
    historySummaries: {},
  };

  applyEvent(store, initialState, {
    type: "RUN_CANCELLED",
    now: now(),
    runId,
    reason: "manual_cancel",
  });

  const updated = store.loadRun(runId);
  return updated ?? run;
}

/**
 * Re-attempt failed stages of a previously terminated run. v0.3 keeps this
 * simple: failed stages are reset to `pending` and the run's loop state
 * returns to `running` so the orchestrator picks them up on its next tick.
 *
 * Returns the list of stage names that were reset. If nothing was failed,
 * the run is returned untouched.
 */
export interface ResumeResult {
  run: RunState;
  resetStages: string[];
}

export function resumeRun(
  store: PipelineStore,
  runId: RunId,
  now: () => number = Date.now,
): ResumeResult {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const resetStages: string[] = [];
  const stages: Record<string, StageState> = {};
  for (const [name, stage] of Object.entries(run.stages)) {
    if (stage.status === "failed") {
      stages[name] = {
        ...stage,
        status: "pending" as StageStatus,
        attempt: stage.attempt + 1,
        ...(stage.errorMessage !== undefined ? { errorMessage: undefined } : {}),
      };
      // Drop the optional errorMessage rather than leaving the previous one in.
      delete (stages[name] as { errorMessage?: string }).errorMessage;
      resetStages.push(name);
    } else {
      stages[name] = stage;
    }
  }

  if (resetStages.length === 0) return { run, resetStages };

  const iso = new Date(now()).toISOString();
  const updated: RunState = {
    ...run,
    stages,
    loopState: "running",
    ...(run.terminationReason ? { terminationReason: undefined } : {}),
    updatedAt: iso,
  };
  delete (updated as { terminationReason?: RunState["terminationReason"] }).terminationReason;
  store.saveRun(updated);
  for (const name of resetStages) {
    store.saveStage({
      ...stages[name],
      runId,
      stageName: name,
    });
  }

  // Re-arm the loop pointer so the orchestrator treats this run as active.
  store.saveLoopState(runId, {
    sessionId: updated.sessionId,
    pipelineName: updated.pipelineName,
    loopState: "running",
    loopRounds: updated.loopRounds,
    lastSha: updated.headSha,
    currentRunId: runId,
    updatedAt: iso,
  });

  return { run: updated, resetStages };
}

/**
 * Pipeline store-schema migration helper. v0.3 ships no schema changes yet —
 * the helper exists so the verb is wired and stable; future schema bumps
 * (the v0.4+ run-versioning epic) plug in here without churning the CLI.
 */
export interface MigrateResult {
  migrated: number;
  message: string;
}

export function migrateStore(_store: PipelineStore): MigrateResult {
  return {
    migrated: 0,
    message: "Pipeline store is already on the v0.3 schema — nothing to migrate.",
  };
}

/**
 * Drive a single reducer step against `initialState` and persist all effects.
 * Intentionally sequential and synchronous: the CLI is one-shot and never
 * spawns stage sessions itself.
 */
function applyEvent(
  store: PipelineStore,
  initialState: EngineState,
  event: PipelineEvent,
): void {
  const result = reduce(initialState, event);
  for (const effect of result.effects) {
    persistEffect(store, effect);
  }
}

function persistEffect(store: PipelineStore, effect: PipelineEffect): void {
  switch (effect.type) {
    case "PERSIST_RUN":
      store.saveRun(effect.runState);
      for (const [stageName, stageState] of Object.entries(effect.runState.stages)) {
        store.saveStage({ ...stageState, runId: effect.runState.runId, stageName });
      }
      break;
    case "PERSIST_LOOP_STATE":
      store.saveLoopState(effect.runId, effect.loopState);
      break;
    case "APPEND_ARTIFACTS":
      store.appendArtifacts(effect.runId, effect.stageRunId, effect.artifacts);
      break;
    case "START_STAGE":
    case "CANCEL_STAGE":
    case "EMIT_OBSERVATION":
      // Side effects owned by the engine driver; CLI is store-only.
      break;
  }
}
