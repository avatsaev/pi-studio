import { randomBytes, randomUUID } from "node:crypto";

import type { Schedule } from "../persistence/entity-schemas.js";
import {
  deleteSchedule as deleteScheduleFile,
  loadAllSchedules,
  saveSchedule,
} from "../persistence/entity-stores.js";
import { assertValidCron, nextCronTime, nextEveryTime } from "./cron.js";

/**
 * Cron/interval schedules + heartbeats (features/schedules-heartbeats.md). A schedule fires a prompt
 * either into a new agent (`new-agent`) or an existing one (`agent`, heartbeat-style). The scheduler
 * loop computes `nextRunAt`, records each `ScheduleRun`, and completes on `maxRuns`/`expiresAt`.
 */

export type Cadence = Schedule["cadence"];
export type ScheduleTarget = Schedule["target"];
export type ScheduleRun = Schedule["runs"][number];

/** Routes a schedule fire to the agent subsystem. */
export interface ScheduleExecutor {
  /** `new-agent` target: create an agent with config + send the prompt. */
  createAndPrompt(
    config: Record<string, unknown>,
    prompt: string,
  ): Promise<{ agentId: string; output?: unknown }>;
  /** `agent` target (heartbeat): prompt an existing agent. */
  promptExisting(agentId: string, prompt: string): Promise<{ output?: unknown }>;
}

export interface ScheduleServiceDeps {
  home: string;
  executor: ScheduleExecutor;
  now?: () => Date;
  idGen?: () => string;
}

export interface CreateScheduleInput {
  name?: string;
  prompt: string;
  cadence: Cadence;
  target: ScheduleTarget;
  expiresAt?: string;
  maxRuns?: number;
}

export class ScheduleService {
  private readonly now: () => Date;
  private readonly idGen: () => string;
  private schedules = new Map<string, Schedule>();
  private loaded = false;

  constructor(private readonly deps: ScheduleServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? (() => randomBytes(4).toString("hex"));
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    for (const schedule of await loadAllSchedules(this.deps.home)) {
      this.schedules.set(schedule.id, schedule);
    }
    this.loaded = true;
  }

  private async persist(schedule: Schedule): Promise<void> {
    schedule.updatedAt = this.nowIso();
    this.schedules.set(schedule.id, schedule);
    await saveSchedule(this.deps.home, schedule);
  }

  /** Compute the next fire time strictly after `from` for a cadence. */
  private computeNextRunAt(cadence: Cadence, from: Date): string | undefined {
    if (cadence.type === "every") return nextEveryTime(cadence.everyMs, from).toISOString();
    const next = nextCronTime(cadence.expression, from, cadence.timezone);
    return next?.toISOString();
  }

  async create(input: CreateScheduleInput): Promise<Schedule> {
    await this.ensureLoaded();
    if (input.cadence.type === "cron") assertValidCron(input.cadence.expression);

    const ts = this.nowIso();
    const schedule: Schedule = {
      id: this.idGen(),
      name: input.name,
      prompt: input.prompt,
      cadence: input.cadence,
      target: input.target,
      status: "active",
      createdAt: ts,
      updatedAt: ts,
      nextRunAt: this.computeNextRunAt(input.cadence, this.now()),
      expiresAt: input.expiresAt,
      maxRuns: input.maxRuns,
      runs: [],
    };
    await this.persist(schedule);
    return schedule;
  }

  async list(): Promise<Schedule[]> {
    await this.ensureLoaded();
    return [...this.schedules.values()];
  }

  async inspect(id: string): Promise<Schedule | null> {
    await this.ensureLoaded();
    return this.schedules.get(id) ?? null;
  }

  async logs(id: string): Promise<ScheduleRun[]> {
    await this.ensureLoaded();
    return this.schedules.get(id)?.runs ?? [];
  }

  async pause(id: string): Promise<Schedule | null> {
    await this.ensureLoaded();
    const schedule = this.schedules.get(id);
    if (!schedule || schedule.status === "completed") return schedule ?? null;
    schedule.status = "paused";
    schedule.pausedAt = this.nowIso();
    schedule.nextRunAt = undefined;
    await this.persist(schedule);
    return schedule;
  }

  async resume(id: string): Promise<Schedule | null> {
    await this.ensureLoaded();
    const schedule = this.schedules.get(id);
    if (!schedule || schedule.status === "completed") return schedule ?? null;
    schedule.status = "active";
    schedule.pausedAt = undefined;
    schedule.nextRunAt = this.computeNextRunAt(schedule.cadence, this.now());
    await this.persist(schedule);
    return schedule;
  }

  async update(id: string, patch: Partial<CreateScheduleInput>): Promise<Schedule | null> {
    await this.ensureLoaded();
    const schedule = this.schedules.get(id);
    if (!schedule) return null;
    if (patch.cadence?.type === "cron") assertValidCron(patch.cadence.expression);
    if (patch.name !== undefined) schedule.name = patch.name;
    if (patch.prompt !== undefined) schedule.prompt = patch.prompt;
    if (patch.target !== undefined) schedule.target = patch.target;
    if (patch.expiresAt !== undefined) schedule.expiresAt = patch.expiresAt;
    if (patch.maxRuns !== undefined) schedule.maxRuns = patch.maxRuns;
    if (patch.cadence !== undefined) {
      schedule.cadence = patch.cadence;
      if (schedule.status === "active") {
        schedule.nextRunAt = this.computeNextRunAt(patch.cadence, this.now());
      }
    }
    await this.persist(schedule);
    return schedule;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    this.schedules.delete(id);
    return deleteScheduleFile(this.deps.home, id);
  }

  /** Execute immediately without altering the regular cadence. */
  async runOnce(id: string): Promise<ScheduleRun | null> {
    await this.ensureLoaded();
    const schedule = this.schedules.get(id);
    if (!schedule) return null;
    const run = await this.executeRun(schedule, this.now());
    await this.persist(schedule);
    return run;
  }

  /**
   * Scheduler tick: fire every active schedule whose `nextRunAt <= now`. Records a run, updates
   * `lastRunAt`, recomputes `nextRunAt`, and completes on `maxRuns`/`expiresAt`.
   */
  async tick(now: Date = this.now()): Promise<void> {
    await this.ensureLoaded();
    for (const schedule of this.schedules.values()) {
      if (schedule.status !== "active") continue;

      // Expiry check first.
      if (schedule.expiresAt && now.getTime() >= new Date(schedule.expiresAt).getTime()) {
        schedule.status = "completed";
        schedule.nextRunAt = undefined;
        await this.persist(schedule);
        continue;
      }

      if (!schedule.nextRunAt || now.getTime() < new Date(schedule.nextRunAt).getTime()) continue;

      const scheduledFor = new Date(schedule.nextRunAt);
      await this.executeRun(schedule, scheduledFor);
      schedule.lastRunAt = scheduledFor.toISOString();

      // Complete on maxRuns, else recompute the next fire from this fire time.
      if (schedule.maxRuns !== undefined && schedule.runs.length >= schedule.maxRuns) {
        schedule.status = "completed";
        schedule.nextRunAt = undefined;
      } else {
        schedule.nextRunAt = this.computeNextRunAt(schedule.cadence, scheduledFor);
        if (
          schedule.expiresAt &&
          schedule.nextRunAt &&
          new Date(schedule.nextRunAt).getTime() >= new Date(schedule.expiresAt).getTime()
        ) {
          schedule.status = "completed";
          schedule.nextRunAt = undefined;
        }
      }
      await this.persist(schedule);
    }
  }

  private async executeRun(schedule: Schedule, scheduledFor: Date): Promise<ScheduleRun> {
    const run: ScheduleRun = {
      id: randomUUID(),
      scheduledFor: scheduledFor.toISOString(),
      startedAt: this.nowIso(),
      status: "running",
    };
    schedule.runs.push(run);
    try {
      if (schedule.target.type === "new-agent") {
        const { agentId, output } = await this.deps.executor.createAndPrompt(
          schedule.target.config,
          schedule.prompt,
        );
        run.agentId = agentId;
        run.output = output;
      } else {
        const { output } = await this.deps.executor.promptExisting(
          schedule.target.agentId,
          schedule.prompt,
        );
        run.output = output;
      }
      run.status = "succeeded";
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
    }
    run.endedAt = this.nowIso();
    return run;
  }
}
