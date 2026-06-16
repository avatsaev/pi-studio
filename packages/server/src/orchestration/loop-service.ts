import { randomBytes } from "node:crypto";

import type { LoopRecord } from "../persistence/entity-schemas.js";
import { createLoopStore } from "../persistence/entity-stores.js";

/**
 * Looping agent runs with shell + LLM verifiers ("Ralph loops") (features/loops.md). Each iteration
 * runs a worker agent, then `verifyChecks` shell commands and an optional `verifyPrompt` verifier;
 * an iteration succeeds only if ALL checks AND the prompt pass. First success ends the loop
 * `succeeded`; exceeding `maxIterations`/`maxTimeMs` ends `failed`; stop ends `stopped` after the
 * current step. On startup, `running` loops are recovered as `stopped` with an interruption log.
 */

export type WorkerOutcome = "completed" | "failed" | "canceled";

export interface LoopVerifyCheckResult {
  command: string;
  exitCode: number;
  passed: boolean;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
}

export interface LoopVerifyPromptResult {
  passed: boolean;
  reason: string;
  verifierAgentId?: string;
  startedAt: string;
  completedAt: string;
}

export interface LoopIteration {
  index: number;
  workerAgentId?: string;
  workerStartedAt: string;
  workerCompletedAt?: string;
  verifierAgentId?: string;
  status: "running" | "succeeded" | "failed";
  workerOutcome?: WorkerOutcome;
  failureReason?: string;
  verifyChecks: LoopVerifyCheckResult[];
  verifyPrompt?: LoopVerifyPromptResult;
}

export interface LoopLogEntry {
  seq: number;
  timestamp: string;
  iteration?: number;
  source: "loop" | "worker" | "verifier" | "verify-check";
  level: "info" | "error";
  text: string;
}

/** Routes loop steps to the agent subsystem + shell. */
export interface LoopExecutor {
  runWorker(input: {
    provider: string;
    model?: string;
    modeId?: string;
    cwd: string;
    prompt: string;
  }): Promise<{ agentId: string; outcome: WorkerOutcome; output?: string }>;
  runShellCheck(
    command: string,
    cwd: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  runVerifier(
    input: { provider: string; model?: string; modeId?: string; cwd: string },
    verifyPrompt: string,
    workerOutput: string | undefined,
  ): Promise<{ passed: boolean; reason: string; agentId?: string }>;
  archiveAgent(agentId: string): Promise<void>;
}

export interface LoopServiceDeps {
  home: string;
  executor: LoopExecutor;
  now?: () => Date;
  idGen?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface LoopRunInput {
  name?: string;
  prompt: string;
  cwd: string;
  provider: string;
  model?: string;
  modeId?: string;
  workerProvider?: string;
  workerModel?: string;
  verifierProvider?: string;
  verifierModel?: string;
  verifierModeId?: string;
  verifyPrompt?: string;
  verifyChecks?: string[];
  archive?: boolean;
  sleepMs?: number;
  maxIterations?: number;
  maxTimeMs?: number;
}

export class LoopService {
  private readonly store: ReturnType<typeof createLoopStore>;
  private readonly now: () => Date;
  private readonly idGen: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private loops = new Map<string, LoopRecord>();
  private readonly stopRequested = new Set<string>();
  private loaded = false;

  constructor(private readonly deps: LoopServiceDeps) {
    this.store = createLoopStore(deps.home);
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? (() => randomBytes(4).toString("hex"));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    for (const rec of await this.store.load()) this.loops.set(rec.id, rec);
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.store.save([...this.loops.values()]);
  }

  private appendLog(rec: LoopRecord, entry: Omit<LoopLogEntry, "seq" | "timestamp">): void {
    const seq = (rec.nextLogSeq ?? 0) as number;
    (rec.logs as LoopLogEntry[]).push({ seq, timestamp: this.nowIso(), ...entry });
    rec.nextLogSeq = seq + 1;
  }

  async list(): Promise<LoopRecord[]> {
    await this.ensureLoaded();
    return [...this.loops.values()];
  }

  async inspect(id: string): Promise<LoopRecord | null> {
    await this.ensureLoaded();
    return this.loops.get(id) ?? null;
  }

  async logs(id: string, sinceSeq = 0): Promise<LoopLogEntry[]> {
    await this.ensureLoaded();
    const rec = this.loops.get(id);
    if (!rec) return [];
    return (rec.logs as LoopLogEntry[]).filter((l) => l.seq >= sinceSeq);
  }

  async stop(id: string): Promise<void> {
    await this.ensureLoaded();
    const rec = this.loops.get(id);
    if (!rec) return;
    this.stopRequested.add(id);
    rec.stopRequestedAt = this.nowIso();
    await this.persist();
  }

  /** Create + run a loop to completion (await the full run). Returns the final record. */
  async run(input: LoopRunInput): Promise<LoopRecord> {
    await this.ensureLoaded();
    const ts = this.nowIso();
    const rec: LoopRecord = {
      id: this.idGen(),
      name: input.name,
      prompt: input.prompt,
      cwd: input.cwd,
      provider: input.provider,
      model: input.model,
      modeId: input.modeId,
      workerProvider: input.workerProvider,
      workerModel: input.workerModel,
      verifierProvider: input.verifierProvider,
      verifierModel: input.verifierModel,
      verifierModeId: input.verifierModeId,
      verifyPrompt: input.verifyPrompt,
      verifyChecks: input.verifyChecks ?? [],
      archive: input.archive ?? false,
      sleepMs: input.sleepMs ?? 0,
      maxIterations: input.maxIterations,
      maxTimeMs: input.maxTimeMs,
      status: "running",
      createdAt: ts,
      updatedAt: ts,
      startedAt: ts,
      iterations: [],
      logs: [],
      nextLogSeq: 0,
    } as LoopRecord;
    this.loops.set(rec.id, rec);
    this.appendLog(rec, { source: "loop", level: "info", text: "loop started" });
    await this.persist();

    await this.runLoop(rec);
    return rec;
  }

  private async runLoop(rec: LoopRecord): Promise<void> {
    const startMs = this.now().getTime();
    let succeeded = false;
    let index = 0;

    while (true) {
      if (this.stopRequested.has(rec.id)) break;
      if (rec.maxIterations !== undefined && index >= rec.maxIterations) break;
      if (rec.maxTimeMs !== undefined && this.now().getTime() - startMs >= rec.maxTimeMs) break;

      index += 1;
      const iteration: LoopIteration = {
        index,
        workerStartedAt: this.nowIso(),
        status: "running",
        verifyChecks: [],
      };
      (rec.iterations as LoopIteration[]).push(iteration);

      // Worker step.
      const worker = await this.deps.executor.runWorker({
        provider: rec.workerProvider ?? rec.provider,
        model: rec.workerModel ?? rec.model,
        modeId: rec.modeId,
        cwd: rec.cwd,
        prompt: rec.prompt,
      });
      iteration.workerAgentId = worker.agentId;
      iteration.workerOutcome = worker.outcome;
      iteration.workerCompletedAt = this.nowIso();
      this.appendLog(rec, {
        source: "worker",
        level: worker.outcome === "completed" ? "info" : "error",
        iteration: index,
        text: `worker ${worker.agentId} ${worker.outcome}`,
      });
      if (rec.archive) await this.deps.executor.archiveAgent(worker.agentId);

      // Verify checks (shell).
      let passed = worker.outcome === "completed";
      for (const command of rec.verifyChecks) {
        const startedAt = this.nowIso();
        const result = await this.deps.executor.runShellCheck(command, rec.cwd);
        const checkPassed = result.exitCode === 0;
        iteration.verifyChecks.push({
          command,
          exitCode: result.exitCode,
          passed: checkPassed,
          stdout: result.stdout,
          stderr: result.stderr,
          startedAt,
          completedAt: this.nowIso(),
        });
        this.appendLog(rec, {
          source: "verify-check",
          level: checkPassed ? "info" : "error",
          iteration: index,
          text: `check \`${command}\` → exit ${result.exitCode}`,
        });
        passed &&= checkPassed;
      }

      // Verifier prompt (LLM).
      if (rec.verifyPrompt) {
        const startedAt = this.nowIso();
        const verdict = await this.deps.executor.runVerifier(
          {
            provider: rec.verifierProvider ?? rec.provider,
            model: rec.verifierModel ?? rec.model,
            modeId: rec.verifierModeId,
            cwd: rec.cwd,
          },
          rec.verifyPrompt,
          worker.output,
        );
        iteration.verifierAgentId = verdict.agentId;
        iteration.verifyPrompt = {
          passed: verdict.passed,
          reason: verdict.reason,
          verifierAgentId: verdict.agentId,
          startedAt,
          completedAt: this.nowIso(),
        };
        this.appendLog(rec, {
          source: "verifier",
          level: verdict.passed ? "info" : "error",
          iteration: index,
          text: `verifier: ${verdict.passed ? "pass" : "fail"} — ${verdict.reason}`,
        });
        passed &&= verdict.passed;
      }

      iteration.status = passed ? "succeeded" : "failed";
      await this.persist();

      if (passed) {
        succeeded = true;
        break;
      }
      await this.sleep(rec.sleepMs ?? 0);
    }

    if (this.stopRequested.has(rec.id)) {
      rec.status = "stopped";
      this.appendLog(rec, { source: "loop", level: "info", text: "loop stopped" });
    } else if (succeeded) {
      rec.status = "succeeded";
      this.appendLog(rec, { source: "loop", level: "info", text: "loop succeeded" });
    } else {
      rec.status = "failed";
      this.appendLog(rec, { source: "loop", level: "error", text: "loop failed (cap reached)" });
    }
    rec.completedAt = this.nowIso();
    rec.updatedAt = rec.completedAt;
    this.stopRequested.delete(rec.id);
    await this.persist();
  }

  /**
   * Boot recovery: loops left `running` (daemon crashed mid-run) → `stopped` with an interruption
   * log entry. This is the recovery hook wired into AgentManager.recover (sprint-005).
   */
  async recover(): Promise<number> {
    await this.ensureLoaded();
    let recovered = 0;
    for (const rec of this.loops.values()) {
      if (rec.status === "running") {
        rec.status = "stopped";
        rec.completedAt = this.nowIso();
        rec.updatedAt = rec.completedAt;
        this.appendLog(rec, {
          source: "loop",
          level: "error",
          text: "loop interrupted by daemon restart; recovered as stopped",
        });
        recovered += 1;
      }
    }
    if (recovered > 0) await this.persist();
    return recovered;
  }
}
