/**
 * Orchestration RPC surface — schedules/heartbeats, chat rooms, and loops, backed by the real disk
 * stores (features/schedules-heartbeats.md, chat-rooms.md, loops.md). These domain services expose
 * method surfaces but no RPC layer; this module wires them for the production daemon.
 *
 * Both the app naming (`create_schedule_request`, `schedule_list_request`, …) and the CLI naming
 * (`schedule_create_request`, `schedule_inspect_request`, …) are accepted where they diverge.
 */

import type { HandlerRegistry } from "../ws/router.js";
import type { ScheduleService, CreateScheduleInput } from "../orchestration/schedule-service.js";
import type { ChatService } from "../orchestration/chat-service.js";
import type { LoopService, LoopRunInput } from "../orchestration/loop-service.js";

export interface OrchestrationRpcDeps {
  scheduleService: ScheduleService;
  chatService: ChatService;
  loopService: LoopService;
}

export function registerOrchestrationHandlers(
  registry: HandlerRegistry,
  deps: OrchestrationRpcDeps,
): void {
  const { scheduleService, chatService, loopService } = deps;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  // ── Schedules ──────────────────────────────────────────────────────────────
  registry.register("schedule_list_request", async (ctx) => ({
    type: "schedule_list_response",
    requestId: ctx.requestId ?? "",
    schedules: await scheduleService.list(),
  }));

  const createSchedule = async (ctx: { message: Record<string, unknown> }) => {
    const m = ctx.message;
    const input = {
      name: (m.name as string | undefined) ?? (m.title as string | undefined),
      prompt: str(m.prompt),
      cadence: m.cadence as CreateScheduleInput["cadence"],
      target: m.target as CreateScheduleInput["target"],
      expiresAt: m.expiresAt as string | undefined,
      maxRuns: m.maxRuns as number | undefined,
    } as CreateScheduleInput;
    return scheduleService.create(input);
  };
  registry.register("create_schedule_request", async (ctx) => ({
    type: "create_schedule_response",
    schedule: await createSchedule(ctx),
  }));
  registry.registerAlias("schedule_create_request", "create_schedule_request");

  registry.register("update_schedule_request", async (ctx) => {
    const id = str(ctx.message.scheduleId ?? ctx.message.id);
    const patch = (ctx.message.patch as Partial<CreateScheduleInput>) ?? {
      ...(ctx.message.prompt !== undefined && { prompt: str(ctx.message.prompt) }),
      ...(ctx.message.cadence !== undefined && { cadence: ctx.message.cadence as CreateScheduleInput["cadence"] }),
      ...(ctx.message.name !== undefined && { name: str(ctx.message.name) }),
    };
    return { type: "update_schedule_response", schedule: await scheduleService.update(id, patch) };
  });
  registry.registerAlias("schedule_update_request", "update_schedule_request");

  registry.register("delete_schedule_request", async (ctx) => ({
    type: "delete_schedule_response",
    scheduleId: str(ctx.message.scheduleId ?? ctx.message.id),
    ok: await scheduleService.delete(str(ctx.message.scheduleId ?? ctx.message.id)),
  }));
  registry.registerAlias("schedule_delete_request", "delete_schedule_request");

  registry.register("pause_schedule_request", async (ctx) => ({
    type: "pause_schedule_response",
    schedule: await scheduleService.pause(str(ctx.message.scheduleId ?? ctx.message.id)),
  }));
  registry.registerAlias("schedule_pause_request", "pause_schedule_request");

  registry.register("resume_schedule_request", async (ctx) => ({
    type: "resume_schedule_response",
    schedule: await scheduleService.resume(str(ctx.message.scheduleId ?? ctx.message.id)),
  }));
  registry.registerAlias("schedule_resume_request", "resume_schedule_request");

  registry.register("schedule_run_once_request", async (ctx) => ({
    type: "schedule_run_once_response",
    run: await scheduleService.runOnce(str(ctx.message.scheduleId ?? ctx.message.id)),
  }));

  registry.register("schedule_logs_request", async (ctx) => ({
    type: "schedule_logs_response",
    runs: await scheduleService.logs(str(ctx.message.scheduleId ?? ctx.message.id)),
  }));

  registry.register("schedule_inspect_request", async (ctx) => ({
    type: "schedule_inspect_response",
    schedule: await scheduleService.inspect(str(ctx.message.scheduleId ?? ctx.message.id)),
  }));

  // ── Chat rooms ───────────────────────────────────────────────────────────────
  registry.register("chat_create_request", async (ctx) => ({
    type: "chat_create_response",
    room: await chatService.createRoom({
      name: str(ctx.message.name),
      purpose: ctx.message.purpose as string | undefined,
    }),
  }));
  registry.register("chat_list_request", async () => ({
    type: "chat_list_response",
    rooms: await chatService.listRooms(),
  }));
  registry.register("chat_inspect_request", async (ctx) => {
    const result = await chatService.inspectRoom(str(ctx.message.roomId));
    return { type: "chat_inspect_response", room: result?.room ?? null, messages: result?.messages ?? [] };
  });
  registry.register("chat_delete_request", async (ctx) => ({
    type: "chat_delete_response",
    roomId: str(ctx.message.roomId),
    ok: await chatService.deleteRoom(str(ctx.message.roomId)),
  }));
  registry.register("chat_post_request", async (ctx) => ({
    type: "chat_post_response",
    message: await chatService.postMessage({
      roomId: str(ctx.message.roomId),
      authorAgentId: str(ctx.message.authorAgentId ?? ctx.message.author ?? "user"),
      body: str(ctx.message.body ?? ctx.message.text),
      replyToMessageId: ctx.message.replyToMessageId as string | undefined,
    }),
  }));
  registry.register("chat_read_request", async (ctx) => {
    const result = await chatService.readMessages(
      str(ctx.message.roomId),
      (ctx.message.cursor as number | undefined) ?? (ctx.message.sinceCursor as number | undefined) ?? 0,
    );
    return { type: "chat_read_response", messages: result.messages, cursor: result.cursor };
  });
  registry.register("chat_wait_request", async (ctx) => {
    const result = await chatService.waitForMessages(
      str(ctx.message.roomId),
      (ctx.message.sinceCursor as number | undefined) ?? (ctx.message.cursor as number | undefined) ?? 0,
      ctx.message.timeoutMs as number | undefined,
    );
    return { type: "chat_wait_response", messages: result.messages, cursor: result.cursor };
  });

  // ── Loops ────────────────────────────────────────────────────────────────────
  registry.register("loop_list_request", async () => ({
    type: "loop_list_response",
    loops: await loopService.list(),
  }));
  registry.register("loop_inspect_request", async (ctx) => ({
    type: "loop_inspect_response",
    loop: await loopService.inspect(str(ctx.message.loopId ?? ctx.message.id)),
  }));
  registry.register("loop_logs_request", async (ctx) => ({
    type: "loop_logs_response",
    logs: await loopService.logs(
      str(ctx.message.loopId ?? ctx.message.id),
      (ctx.message.sinceSeq as number | undefined) ?? 0,
    ),
  }));
  registry.register("loop_stop_request", async (ctx) => {
    await loopService.stop(str(ctx.message.loopId ?? ctx.message.id));
    return { type: "loop_stop_response", loopId: str(ctx.message.loopId ?? ctx.message.id), ok: true };
  });
  registry.register("loop_run_request", (ctx) => {
    // Loops are long-running; start it in the background and ack immediately so
    // the RPC does not block for the loop's lifetime.
    const input = ctx.message as unknown as LoopRunInput;
    void loopService.run(input).catch(() => {});
    return { type: "loop_run_response", ok: true, started: true };
  });
}
