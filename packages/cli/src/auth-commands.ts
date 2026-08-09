import type { Command } from "commander";

import {
  AuthPromptAbortedError,
  createApiKeyInteraction,
  createTerminalIo,
  createTerminalInteraction,
  type TerminalIo,
} from "./auth-interaction.js";
import {
  type AuthInteractionLike,
  type AuthProviderInfo,
  type AuthRuntime,
  type AuthStatusInfo,
  defaultAuthRuntime,
  resolvePiAuthPaths,
} from "./auth-runtime.js";
import {
  type CliContext,
  type GlobalOptions,
  EXIT_ERROR,
  EXIT_OK,
  errorMessage,
} from "./cli-core.js";
import { renderTable } from "./output.js";

/**
 * `auth` command group (features/provider-auth-cli.md § Public Contract — Commands table,
 * § Behavior — status/logout/login, § Error Handling). Never opens a WebSocket — these commands
 * talk directly to Pi's local auth store through the task-001 `AuthRuntime` seam.
 */

/** Bounded per-provider checkAuth probe; shared with task 004's provider picker. */
export const CHECK_AUTH_TIMEOUT_MS = 3000;

function runtimeOf(ctx: CliContext, opts: GlobalOptions): AuthRuntime {
  return ctx.auth ?? defaultAuthRuntime(resolvePiAuthPaths(opts));
}

/**
 * Probe one provider's auth status with a bounded timeout. A hang (e.g. a slow ambient probe:
 * an AWS-profile or ADC-file check) degrades to `"unknown"` rather than blocking the whole
 * command — or, for task 004, the provider picker.
 */
export async function checkAuthBounded(
  runtime: AuthRuntime,
  providerId: string,
  timeoutMs = CHECK_AUTH_TIMEOUT_MS,
): Promise<AuthStatusInfo | "unknown"> {
  const { promise: timeout, resolve: resolveTimeout } = Promise.withResolvers<"unknown">();
  const timer = setTimeout(() => resolveTimeout("unknown"), timeoutMs);
  try {
    return await Promise.race([runtime.checkAuth(providerId), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Row shape shared by table and JSON rendering. */
export interface AuthStatusRow {
  id: string;
  name: string;
  configured: boolean | "unknown";
  type?: "api_key" | "oauth";
  source?: string;
}

async function buildStatusRows(runtime: AuthRuntime): Promise<AuthStatusRow[]> {
  const providers = await runtime.listProviders();
  const rows = await Promise.all(
    providers.map(async (p): Promise<AuthStatusRow> => {
      const status = await checkAuthBounded(runtime, p.id);
      if (status === "unknown") return { id: p.id, name: p.name, configured: "unknown" };
      if (!status.configured) return { id: p.id, name: p.name, configured: false };
      return { id: p.id, name: p.name, configured: true, type: status.type, source: status.source };
    }),
  );
  return rows.toSorted((a, b) => a.id.localeCompare(b.id));
}

function statusLabel(row: AuthStatusRow): string {
  if (row.configured === "unknown") return "unknown";
  if (!row.configured) return "not configured";
  return row.type === "oauth" ? "oauth" : "api key";
}

function sourceLabel(row: AuthStatusRow): string {
  if (row.configured !== true) return "";
  return row.source ?? "auth.json";
}

async function runAuthStatus(ctx: CliContext, opts: GlobalOptions): Promise<number> {
  const runtime = runtimeOf(ctx, opts);
  const rows = await buildStatusRows(runtime);

  if (opts.json) {
    ctx.sink.write(
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          configured: r.configured,
          type: r.type,
          source: r.source,
        })),
      ),
    );
    return EXIT_OK;
  }

  ctx.sink.write(
    renderTable(
      rows.map((r) => ({
        PROVIDER: r.id,
        NAME: r.name,
        STATUS: statusLabel(r),
        SOURCE: sourceLabel(r),
      })),
      ["PROVIDER", "NAME", "STATUS", "SOURCE"],
    ),
  );
  ctx.sink.error(runtime.authPathLabel());
  return EXIT_OK;
}

function unknownProviderMessage(providers: AuthProviderInfo[], providerId: string): string {
  const validIds = providers.map((p) => p.id).join(", ");
  return `Unknown provider "${providerId}". Valid ids: ${validIds}`;
}

async function runAuthLogout(
  ctx: CliContext,
  opts: GlobalOptions,
  providerId: string,
): Promise<number> {
  const runtime = runtimeOf(ctx, opts);
  const providers = await runtime.listProviders();
  if (!providers.some((p) => p.id === providerId)) {
    ctx.sink.error(unknownProviderMessage(providers, providerId));
    return EXIT_ERROR;
  }

  const before = await runtime.checkAuth(providerId);
  await runtime.logout(providerId);

  ctx.sink.write(
    before.configured
      ? `${providerId}: removed stored credential (${runtime.authPathLabel()}).`
      : `${providerId}: nothing stored.`,
  );

  // Re-check *after* removal: while a stored credential exists, checkAuth() reports it, not an
  // ambient one behind it — the ambient source only becomes visible once the stored one is gone.
  const after = await runtime.checkAuth(providerId);
  if (after.configured) {
    const source = after.source ?? "an ambient source";
    ctx.sink.write(`${providerId} is still configured via ${source} — logout does not remove it.`);
  }

  return EXIT_OK;
}

// ─── auth login ─────────────────────────────────────────────────────────────────

function supportedTypesLabel(provider: AuthProviderInfo): string {
  const types: string[] = [];
  if (provider.canApiKeyLogin) types.push("api_key");
  if (provider.canOAuthLogin) types.push("oauth");
  return types.length > 0 ? types.join(", ") : "none";
}

function typeUnsupportedError(
  provider: AuthProviderInfo,
  type: "api_key" | "oauth",
): string | undefined {
  const supported = type === "api_key" ? provider.canApiKeyLogin : provider.canOAuthLogin;
  if (supported) return undefined;
  return `Provider "${provider.id}" does not support --type ${type}. Supported: ${supportedTypesLabel(provider)}.`;
}

function providerPickerLabel(
  provider: AuthProviderInfo,
  status: AuthStatusInfo | "unknown",
): string {
  const methods: string[] = [];
  if (provider.canApiKeyLogin) methods.push("api key");
  if (provider.canOAuthLogin) methods.push(provider.oauthLoginLabel ?? "oauth");
  const badges: string[] = [];
  if (provider.oauthIsSubscription) badges.push("subscription");
  if (status !== "unknown" && status.configured) badges.push("already configured");
  const suffix = [
    methods.length > 0 ? `(${methods.join(", ")})` : "",
    badges.length > 0 ? `[${badges.join(", ")}]` : "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");
  return suffix.length > 0 ? `${provider.name} ${suffix}` : provider.name;
}

/** No-argument `login`: render a picker over every login-capable provider. */
async function pickProviderInteractively(
  runtime: AuthRuntime,
  providers: AuthProviderInfo[],
  interaction: AuthInteractionLike,
): Promise<AuthProviderInfo> {
  const statuses = await Promise.all(providers.map((p) => checkAuthBounded(runtime, p.id)));
  const options = providers.map((p, i) => ({
    id: p.id,
    label: providerPickerLabel(p, statuses[i]!),
  }));
  const selectedId = await interaction.prompt({
    type: "select",
    message: "Select a provider to log in",
    options,
  });
  return providers.find((p) => p.id === selectedId)!;
}

/** `--type` given → use it (pre-validated). One method → no prompt. Both → one select prompt. */
async function resolveLoginMethod(
  provider: AuthProviderInfo,
  interaction: AuthInteractionLike,
): Promise<"api_key" | "oauth"> {
  if (provider.canApiKeyLogin && !provider.canOAuthLogin) return "api_key";
  if (provider.canOAuthLogin && !provider.canApiKeyLogin) return "oauth";
  const chosen = await interaction.prompt({
    type: "select",
    message: `How would you like to authenticate with ${provider.name}?`,
    options: [
      { id: "api_key", label: "API key" },
      { id: "oauth", label: provider.oauthLoginLabel ?? "OAuth" },
    ],
  });
  return chosen === "oauth" ? "oauth" : "api_key";
}

/**
 * `auth login [provider] [--type api_key|oauth] [--api-key K]` (features/provider-auth-cli.md
 * § Behavior & Algorithms — `authLogin`, § Error Handling & Edge Cases). Exported so tests can
 * drive it directly with a fake `TerminalIo`, bypassing Commander. `io` is left unresolved (no
 * default-parameter expression) until *after* the flow's `AbortController` exists —
 * `createTerminalIo()` needs it to map inquirer's Ctrl+C rejection (`ExitPromptError`) to a flow
 * abort (inquirer traps SIGINT itself while a prompt is live; see auth-interaction.ts) — and only
 * when the caller omits `io` at all and the flow actually needs terminal I/O (never for
 * `--api-key`, which uses a prefilled interaction instead), so no prompt machinery — and no Pi
 * import further down the call chain — is created at module load, registration, pre-flight-error,
 * or headless-login time.
 */
export async function runAuthLogin(
  ctx: CliContext,
  opts: GlobalOptions,
  providerArg: string | undefined,
  cmdOpts: { type?: string; apiKey?: string },
  io?: TerminalIo,
): Promise<number> {
  if (cmdOpts.type && cmdOpts.type !== "api_key" && cmdOpts.type !== "oauth") {
    ctx.sink.error(`Invalid --type "${cmdOpts.type}". Must be "api_key" or "oauth".`);
    io?.close();
    return EXIT_ERROR;
  }
  if (cmdOpts.apiKey !== undefined && cmdOpts.type === "oauth") {
    ctx.sink.error("--api-key implies --type api_key; it cannot be combined with --type oauth.");
    io?.close();
    return EXIT_ERROR;
  }
  if (cmdOpts.apiKey !== undefined && !providerArg) {
    ctx.sink.error(
      "--api-key requires an explicit provider argument, e.g. `auth login openai --api-key K`.",
    );
    io?.close();
    return EXIT_ERROR;
  }
  const requestedType: "api_key" | "oauth" | undefined =
    cmdOpts.apiKey !== undefined ? "api_key" : (cmdOpts.type as "api_key" | "oauth" | undefined);

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  // Non-TTY guard: only the interactive path (no --api-key) needs a prompt at all, and only that
  // path needs terminal I/O, so this is also the only branch that ever constructs `io` — resolved
  // here, before the Pi runtime is touched at all, so the guard never pays for it either.
  let actualIo: TerminalIo | undefined;
  if (cmdOpts.apiKey === undefined) {
    actualIo = io ?? createTerminalIo(controller);
    if (!actualIo.isTty) {
      ctx.sink.error(
        "Interactive login needs a TTY; use --api-key <key> with an explicit provider for a " +
          "non-interactive setup (scripts, CI, provisioning). OAuth providers cannot be " +
          "authenticated this way — they need a real interactive login.",
      );
      process.removeListener("SIGINT", onSigint);
      actualIo.close();
      return EXIT_ERROR;
    }
  }

  const runtime = runtimeOf(ctx, opts);
  const providers = await runtime.listProviders();

  // Pre-flight (before any prompt): a known provider argument can be fully validated up front.
  if (providerArg) {
    const found = providers.find((p) => p.id === providerArg);
    if (!found) {
      ctx.sink.error(unknownProviderMessage(providers, providerArg));
      process.removeListener("SIGINT", onSigint);
      actualIo?.close();
      return EXIT_ERROR;
    }
    if (requestedType) {
      const err = typeUnsupportedError(found, requestedType);
      if (err) {
        ctx.sink.error(err);
        process.removeListener("SIGINT", onSigint);
        actualIo?.close();
        return EXIT_ERROR;
      }
    }
  }

  const interaction: AuthInteractionLike =
    cmdOpts.apiKey !== undefined
      ? createApiKeyInteraction({
          apiKey: cmdOpts.apiKey,
          sink: ctx.sink,
          signal: controller.signal,
        })
      : createTerminalInteraction({ io: actualIo!, sink: ctx.sink, signal: controller.signal });

  try {
    const provider = providerArg
      ? providers.find((p) => p.id === providerArg)!
      : await pickProviderInteractively(runtime, providers, interaction);

    // The picker path only learns the provider here, so --type validation against it is deferred.
    if (!providerArg && requestedType) {
      const err = typeUnsupportedError(provider, requestedType);
      if (err) {
        ctx.sink.error(err);
        return EXIT_ERROR;
      }
    }

    const type = requestedType ?? (await resolveLoginMethod(provider, interaction));
    const credential = await runtime.login(provider.id, type, interaction);

    ctx.sink.write(
      `${provider.id}: logged in (${credential.type}). Credential stored at ${runtime.authPathLabel()}.`,
    );
    ctx.sink.write("Agents pick this up automatically on their next spawn — no restart needed.");
    return EXIT_OK;
  } catch (error) {
    // `controller.signal.aborted` is authoritative for "the user cancelled": Pi's own login()
    // implementation independently races `interaction.signal` (the documented "abort the whole
    // flow" contract) and, on abort, throws its own generic AbortError — not our
    // `AuthPromptAbortedError` — so recognizing only that class here would misreport a real
    // cancellation as a login failure whenever Pi's own abort path wins the race.
    if (controller.signal.aborted || error instanceof AuthPromptAbortedError) {
      ctx.sink.error("login cancelled");
      return EXIT_ERROR;
    }
    ctx.sink.error(errorMessage(error));
    return EXIT_ERROR;
  } finally {
    process.removeListener("SIGINT", onSigint);
    actualIo?.close();
  }
}

export function registerAuthCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();
  const auth = program.command("auth").description("manage model provider credentials");

  auth
    .command("status")
    .description("show which model providers are configured, how, and from where")
    .action(async () => {
      setExit(await runAuthStatus(ctx, g()));
    });

  auth
    .command("logout <provider>")
    .description("remove a stored provider credential")
    .action(async (provider: string) => {
      setExit(await runAuthLogout(ctx, g(), provider));
    });

  auth
    .command("login [provider]")
    .description("log in to a model provider (interactive, or headless with --api-key)")
    .option("--type <type>", "authentication method: api_key or oauth")
    .option(
      "--api-key <key>",
      "store this key non-interactively (requires a provider argument; visible in shell " +
        "history and process listings)",
    )
    .action(async (provider: string | undefined, cmdOpts: { type?: string; apiKey?: string }) => {
      setExit(await runAuthLogin(ctx, g(), provider, cmdOpts));
    });
}
