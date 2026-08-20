/**
 * LoginDialog — drives one provider-auth login flow end to end (sprint-065/task-004): renders
 * every prompt kind the flow can ask, a rolling status region, and the terminal success/error
 * states. Mounted once, always, from `SettingsDialog.tsx`; it renders nothing until
 * `useProviderAuthUiStore`'s `pendingLogin` is set by `ModelProvidersPanel`'s `Log in`/`Re-login`.
 *
 * The component is thin by contract: `login-flow.ts` (task-002) owns every step/ordering
 * decision, `@av-pi-studio/client`'s `loginProvider` (task-001) owns the wire plumbing. What lives
 * here is rendering, focus, and wiring the user's answer to the pending prompt's resolver — which
 * lives in a ref, not reducer state, so the reducer stays pure and the resolver can be rejected
 * on unmount without threading a promise through dispatched actions.
 *
 * `LoginDialogFlow` is remounted (via the outer `LoginDialog`'s `key`) once per attempt — see
 * `provider-auth-store.ts`'s `attempt` field — so a `Try again` after a failure starts genuinely
 * fresh: new reducer state, new resolver ref, new `loginProvider()` call, new `AbortController`.
 *
 * swe/features/provider-auth-ui.md § Web UI surface (login-dialog step rendering table),
 * § Behavior & Algorithms, § Error Handling & Edge Cases.
 */

import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import type { PiStudioClient, ProviderAuthPromptUi } from "@av-pi-studio/client";
import type { ProviderAuthType } from "@av-pi-studio/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink } from "lucide-react";
import {
  Button,
  Dialog,
  IconButton,
  Spinner,
  TextInput,
} from "@pi-studio-ui/components/primitives/index.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { copyText } from "@pi-studio-ui/lib/clipboard.js";
import {
  applyLoginFlowEvent,
  initialLoginFlowState,
  type AuthUrlPresentation,
  type DeviceCodePresentation,
  type LoginFlowState,
} from "./login-flow.js";
import { QrCode } from "./QrCode.js";
import { useProviderAuthUiStore } from "./provider-auth-store.js";
import styles from "./LoginDialog.module.css";

/** Auto-close delay after a successful login — long enough to read the confirmation, short
 *  enough not to feel stuck. */
const SUCCESS_CLOSE_DELAY_MS = 1200;

/** Links the body's prompt form to the footer's Submit button (HTML `form` attribute), so both
 *  dialog actions live in the footer's action row while Enter-in-the-input still submits. Only
 *  one login dialog is ever mounted (one flow at a time), so a constant id cannot collide. */
const PROMPT_FORM_ID = "provider-auth-prompt-form";

interface PendingPromptResolver {
  promptId: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

export function LoginDialog() {
  const pendingLogin = useProviderAuthUiStore((s) => s.pendingLogin);
  const cancelLogin = useProviderAuthUiStore((s) => s.cancelLogin);
  const clearLogin = useProviderAuthUiStore((s) => s.clearLogin);
  const retryLogin = useProviderAuthUiStore((s) => s.retryLogin);
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  // Stable identity: the success effect below depends on this callback, and an inline arrow would
  // make that effect re-run on every render — restarting the auto-close timer each time (so it
  // never fires) and re-invalidating the provider list on every pass.
  const onSuccess = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: rpcKeys.providerAuthList() });
  }, [queryClient]);

  if (!pendingLogin || !client) return null;

  return (
    <LoginDialogFlow
      key={`${pendingLogin.provider}:${pendingLogin.authType}:${pendingLogin.attempt}`}
      provider={pendingLogin.provider}
      providerName={pendingLogin.providerName}
      authType={pendingLogin.authType}
      controller={pendingLogin.controller}
      client={client}
      onCancel={cancelLogin}
      onClear={clearLogin}
      onRetry={retryLogin}
      onSuccess={onSuccess}
    />
  );
}

interface LoginDialogFlowProps {
  provider: string;
  providerName: string;
  authType: ProviderAuthType;
  controller: AbortController;
  client: PiStudioClient;
  /** Mid-flight dismissal (Cancel/Esc/backdrop while not yet terminal): aborts server-side. */
  onCancel: () => void;
  /** Terminal-state dismissal (auto-close, or Close after success/error): no abort needed. */
  onClear: () => void;
  onRetry: () => void;
  onSuccess: () => void;
}

function LoginDialogFlow({
  provider,
  providerName,
  authType,
  controller,
  client,
  onCancel,
  onClear,
  onRetry,
  onSuccess,
}: LoginDialogFlowProps) {
  const [state, dispatch] = useReducer(
    applyLoginFlowEvent,
    initialLoginFlowState(provider, authType),
  );
  const promptRef = useRef<PendingPromptResolver | null>(null);
  // React StrictMode double-invokes effects in dev (mount → cleanup → remount) on the *same*
  // fiber, so these two refs must live outside the effect closure — see `TerminalPanel.tsx`'s
  // `isMountedRef` precedent for the same hazard.
  //
  // `startedRef` keeps the phantom remount from calling `loginProvider()` a second time while the
  // first flow is still active, which throws synchronously ("a provider-auth login is already in
  // progress"). `mountedRef` gates the terminal dispatch and MUST NOT be a plain closure flag:
  // the phantom cleanup would set that flag false for the very closure that owns the running
  // flow, permanently swallowing its `done` event — prompts would still render and answer (the
  // credential even lands on disk) while the dialog sat forever on the last prompt. A ref instead
  // gets set back to true by the phantom remount, and only a real unmount leaves it false.
  const startedRef = useRef(false);
  const mountedRef = useRef(false);
  const [inputValue, setInputValue] = useState("");
  const [answeredPromptId, setAnsweredPromptId] = useState<string | null>(null);

  // Starts the flow exactly once for this mounted attempt — a retry remounts the whole component
  // (see the outer `LoginDialog`'s `key`), which is what gives this effect fresh `provider`/
  // `authType`/`controller`/`client` rather than needing to react to them changing in place.
  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      client
        .loginProvider(
          provider,
          authType,
          {
            prompt: (prompt: ProviderAuthPromptUi) =>
              new Promise<string>((resolve, reject) => {
                promptRef.current = { promptId: prompt.promptId, resolve, reject };
                dispatch({ kind: "prompt", ...prompt });
                // Pi races a `manual_code` prompt against its own OAuth callback server, so the
                // callback winning retires the question while the flow continues. The promise
                // returned here is then discarded by the SDK — this signal is the only notice.
                // Leave it unsettled on purpose: nobody is waiting on it any more.
                prompt.signal?.addEventListener(
                  "abort",
                  () => {
                    if (promptRef.current?.promptId === prompt.promptId) promptRef.current = null;
                    setInputValue("");
                    dispatch({ kind: "prompt_cancelled", promptId: prompt.promptId });
                  },
                  { once: true },
                );
              }),
            onEvent: (event) => dispatch(event),
          },
          { signal: controller.signal },
        )
        .then((result) => {
          if (mountedRef.current) dispatch({ kind: "done", ok: result.ok, error: result.error });
        })
        .catch((error: unknown) => {
          // A rejection here is the flow failing to start/run at all (never a cancelled prompt,
          // which the SDK swallows). Surface it as the error state rather than hanging.
          if (mountedRef.current) {
            dispatch({
              kind: "done",
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }
    return () => {
      mountedRef.current = false;
      // No dangling resolver: the SDK's own `answered.catch(() => {})` (pistudio-client.ts) means
      // this rejection is always observed, never an unhandled-rejection console warning.
      promptRef.current?.reject(new Error("login dialog closed"));
      promptRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase !== "done" || !state.result?.ok) return undefined;
    onSuccess();
    const timer = setTimeout(onClear, SUCCESS_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.phase, state.result?.ok, onSuccess, onClear]);

  function submitPromptValue(value: string) {
    const pending = promptRef.current;
    if (!pending) return;
    promptRef.current = null;
    // An answered question must stop rendering. The reducer keeps `state.prompt` until the *next*
    // prompt or `done` arrives (correct — it is a pure log of what the daemon said), and several
    // flows sit in a progress step for seconds afterwards: GitHub Copilot's device-code step left
    // the already-answered "GitHub Enterprise URL/domain" question on screen, with an empty box,
    // next to the code the user is supposed to be reading. Tracked here rather than in the reducer
    // because "this view has answered" is view state, not flow state.
    setAnsweredPromptId(pending.promptId);
    setInputValue(""); // clear immediately — a secret value never lingers in component state
    pending.resolve(value);
  }

  function handleTextSubmit(event: FormEvent) {
    event.preventDefault();
    submitPromptValue(inputValue);
  }

  function handleOpenChange(next: boolean) {
    if (next) return;
    if (state.phase === "done") onClear();
    else onCancel();
  }

  const isDone = state.phase === "done";
  const isSuccess = isDone && state.result?.ok === true;
  const isFailure = isDone && state.result?.ok === false;
  /** The prompt still awaiting an answer, if any — never one this view already answered. */
  const livePrompt =
    state.phase === "prompt" && state.prompt && state.prompt.promptId !== answeredPromptId
      ? state.prompt
      : undefined;
  // A `select` prompt is answered by clicking an option, so it contributes no footer action —
  // only the text-ish kinds (`secret`/`text`/`manual_code`) get a Submit.
  const textPrompt = livePrompt && livePrompt.promptKind !== "select" ? livePrompt : undefined;

  return (
    <Dialog
      open
      onOpenChange={handleOpenChange}
      title={`Log in to ${providerName}`}
      width={480}
      footer={
        isDone ? (
          <>
            <Button variant="ghost" onClick={onClear}>
              Close
            </Button>
            {isFailure && <Button onClick={onRetry}>Try again</Button>}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {textPrompt && (
              // Associated with the body's form by id, so Enter-in-the-input and this click are
              // the same submit path while both actions still sit in the footer's action row.
              //
              // Deliberately NOT disabled on an empty input: blank is a meaningful answer to some
              // prompts — GitHub Copilot opens with "GitHub Enterprise URL/domain (blank for
              // github.com)", and gating on length made that flow impossible to advance. The
              // provider decides what it accepts, exactly as `pi-studio auth login` does (its
              // `@inquirer/prompts` input carries no non-empty validation either).
              <Button type="submit" form={PROMPT_FORM_ID}>
                Submit
              </Button>
            )}
          </>
        )
      }
    >
      <div className={styles.body}>
        <StatusRegion state={state} />
        {/* The OAuth blocks render *alongside* a live prompt, never instead of it: Pi races a
            `manual_code` prompt against its localhost callback, so the url and the paste field must
            be on screen together — the whole point of the remote-login case. When the callback wins
            the race, `prompt_cancelled` drops only the input and these stay. */}
        {!isDone && state.authUrl && (
          <AuthUrlBlock authUrl={state.authUrl} showInstructions={!textPrompt} />
        )}
        {!isDone && state.deviceCode && (
          <DeviceCodeBlock deviceCode={state.deviceCode} stopped={isDone} />
        )}
        {livePrompt && (
          <PromptInput
            prompt={livePrompt}
            inputValue={inputValue}
            onInputChange={setInputValue}
            onTextSubmit={handleTextSubmit}
            onSelect={submitPromptValue}
          />
        )}
        {isSuccess && <p className={styles.success}>Signed in. Closing…</p>}
        {isFailure && <p className={styles.error}>{state.result?.error ?? "Login failed."}</p>}
      </div>
    </Dialog>
  );
}

function StatusRegion({ state }: { state: LoginFlowState }) {
  if (state.statusLines.length === 0 && state.phase !== "starting") return null;
  return (
    <div className={styles.status}>
      {state.phase === "starting" && (
        <div className={styles.statusLine}>
          <Spinner size="sm" /> Starting…
        </div>
      )}
      {state.statusLines.map((line, i) => (
        <div
          key={i}
          className={line.kind === "progress" ? styles.statusLineProgress : styles.statusLine}
        >
          {line.kind === "progress" && <Spinner size="sm" />}
          {/* Message and links stack: side by side, a long message squeezes a link into an
              unreadable column. */}
          <span className={styles.statusText}>
            <span>{line.message}</span>
            {line.links?.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label ?? link.url}
              </a>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

interface PromptInputProps {
  prompt: ProviderAuthPromptUi;
  inputValue: string;
  onInputChange: (value: string) => void;
  onTextSubmit: (event: FormEvent) => void;
  onSelect: (id: string) => void;
}

function PromptInput({
  prompt,
  inputValue,
  onInputChange,
  onTextSubmit,
  onSelect,
}: PromptInputProps) {
  if (prompt.promptKind === "select") {
    return (
      <div className={styles.prompt}>
        <p className={styles.promptMessage}>{prompt.message}</p>
        <div className={styles.options}>
          {prompt.options?.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles.option}
              onClick={() => onSelect(option.id)}
            >
              <span className={styles.optionLabel}>{option.label}</span>
              {option.description && (
                <span className={styles.optionDescription}>{option.description}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form id={PROMPT_FORM_ID} className={styles.prompt} onSubmit={onTextSubmit}>
      <label className={styles.promptMessage} htmlFor="login-prompt-input">
        {prompt.message}
      </label>
      <TextInput
        id="login-prompt-input"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        type={prompt.promptKind === "secret" ? "password" : "text"}
        autoComplete={prompt.promptKind === "secret" ? "off" : undefined}
        // A secret's value never reaches a password manager: `autoComplete="off"` alone is
        // ignored by modern Chrome on password fields, so vendor-specific opt-outs are needed
        // too (1Password/LastPass/Bitwarden inject their own save/generate icon otherwise).
        data-1p-ignore={prompt.promptKind === "secret" ? "true" : undefined}
        data-lpignore={prompt.promptKind === "secret" ? "true" : undefined}
        data-bwignore={prompt.promptKind === "secret" ? "true" : undefined}
        placeholder={prompt.placeholder}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
      />
      {/* Submit lives in the dialog footer (associated by `form={PROMPT_FORM_ID}`) so both
          actions sit in one action row rather than straddling body and footer. */}
    </form>
  );
}

/** How long the copied-confirmation icon stays up. */
const COPIED_FEEDBACK_MS = 1800;

/** Icon-only copy action. A labelled text button read as a caption next to the url rather than as
 *  something clickable, and pushed the row's alignment out. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      size="sm"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void copyText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </IconButton>
  );
}

function AuthUrlBlock({
  authUrl,
  showInstructions,
}: {
  authUrl: AuthUrlPresentation;
  showInstructions: boolean;
}) {
  return (
    <div className={styles.oauth}>
      {/* Suppressed while a text prompt is live: the provider's `auth_url` instructions and that
          prompt's own message say the same thing in different words ("Complete login in your
          browser…" twice, stacked), which is what made this dialog look padded with filler. */}
      {showInstructions && authUrl.instructions && (
        <p className={styles.oauthInstructions}>{authUrl.instructions}</p>
      )}
      <div className={styles.oauthMain}>
        <div className={styles.oauthActions}>
          {/* A real anchor, not a scripted `window.open` (popup-blocked without a gesture) and not
              `Button` (which renders only a `<button>`), so middle-click and "copy link address"
              behave. Styled to match `Button`'s default variant. */}
          <a className={styles.openButton} href={authUrl.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            Open login page
          </a>
          <div className={styles.urlRow}>
            <span className={styles.oauthUrl}>{authUrl.url}</span>
            <CopyButton value={authUrl.url} label="Copy link" />
          </div>
        </div>
        <div className={styles.oauthQr}>
          <QrCode value={authUrl.url} label="QR code for the provider's login page" />
          <span className={styles.oauthQrCaption}>Scan on another device</span>
        </div>
      </div>
    </div>
  );
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function DeviceCodeBlock({
  deviceCode,
  stopped,
}: {
  deviceCode: DeviceCodePresentation;
  stopped: boolean;
}) {
  const [remaining, setRemaining] = useState<number | undefined>(deviceCode.expiresInSeconds);

  // The countdown is view-local on purpose: the reducer stays pure (no timers, no `Date.now()`),
  // holding only the expiry the daemon sent. Cleanup covers both required stops — unmount, and
  // `done` flipping `stopped`.
  useEffect(() => {
    if (stopped || deviceCode.expiresInSeconds === undefined) return undefined;
    setRemaining(deviceCode.expiresInSeconds);
    const id = setInterval(() => {
      setRemaining((prev) => (prev === undefined ? undefined : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [deviceCode.expiresInSeconds, stopped]);

  return (
    <div className={styles.oauth}>
      <div className={styles.oauthMain}>
        <div className={styles.oauthActions}>
          <span className={styles.oauthInstructions}>Enter this code at the verification page</span>
          <div className={styles.urlRow}>
            <span className={styles.deviceCode}>{deviceCode.userCode}</span>
            {/* Copyable: the alternative is retyping a hyphenated code by hand. */}
            <CopyButton value={deviceCode.userCode} label="Copy code" />
          </div>
          <a
            className={styles.openButton}
            href={deviceCode.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} />
            Open verification page
          </a>
          {remaining !== undefined && (
            <span className={styles.countdown}>
              {remaining > 0 ? `Expires in ${formatCountdown(remaining)}` : "Code expired"}
            </span>
          )}
        </div>
        <div className={styles.oauthQr}>
          <QrCode value={deviceCode.verificationUri} label="QR code for the verification page" />
          <span className={styles.oauthQrCaption}>Scan on another device</span>
        </div>
      </div>
    </div>
  );
}
