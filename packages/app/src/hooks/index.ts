/**
 * Hooks package index — session store selectors, React Query hooks, client context.
 */

export {
  useAgentEntry,
  useAgentStatus,
  useAgentTimeline,
  useAgentCapabilities,
  useAgentPermissions,
  useOptimisticMessages,
  useWorkspaceDescriptor,
  useWorkspaceList,
  useServerInfo,
  useActiveServerId,
  useAgentDirectory,
  useSessionsQuery,
  useAgentMutation,
  useSendMessageMutation,
  usePermissionMutation,
  subscribeSessionStore,
  SESSION_QUERY_KEYS,
} from "./use-session-hooks.js";

export type {
  SessionListEntry,
  CreateAgentInput,
  SendMessageInput,
  RespondPermissionInput,
} from "./use-session-hooks.js";

export { ClientProvider, useClient } from "./client-context.js";

export {
  useDraft,
  useComposerController,
  kvToLayoutStorage,
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
} from "./use-composer.js";

export type {
  UseDraftResult,
  ComposerController,
  UseComposerControllerOptions,
} from "./use-composer.js";

export {
  useComposerAutocomplete,
  useAgentModeControl,
} from "./use-composer-autocomplete.js";

export type {
  ComposerAutocompleteData,
  AgentModeControl,
} from "./use-composer-autocomplete.js";

export {
  useAgentUsage,
  useProviderUsage,
  useProviderUsageSupported,
  USAGE_QUERY_KEYS,
} from "./use-usage.js";

export type {
  AgentUsageView,
  ProviderUsageEntry,
} from "./use-usage.js";

export { usePermissionResponder } from "./use-permission.js";
export type { UsePermissionResult } from "./use-permission.js";

export { useToolCallDetail, TOOL_DETAIL_RPC, TOOL_DETAIL_QUERY_KEYS } from "./use-tool-detail.js";
export type { UseToolDetailResult } from "./use-tool-detail.js";

export { useRewind, useFork } from "./use-rewind.js";
export type { UseRewindResult, UseForkResult } from "./use-rewind.js";

export { usePrReview } from "./use-pr-review.js";
export type { UsePrReviewResult } from "./use-pr-review.js";

export { useCheckoutStatus } from "./use-checkout-status.js";
export type { UseCheckoutStatusResult } from "./use-checkout-status.js";

export {
  useAgentTimelineSubscription,
} from "./use-timeline-hooks.js";

export type { UseAgentTimelineResult } from "./use-timeline-hooks.js";

export {
  useWorkspaceRouteState,
} from "./use-workspace-route.js";

export type { WorkspaceRouteState } from "./use-workspace-route.js";

export {
  useWorkspaceHeaderData,
  useSidebarData,
  useWorkspaceShortcuts,
} from "./use-workspace-shell.js";

export type {
  WorkspaceHeaderData,
  SidebarWorkspaceItem,
  WorkspaceShortcutAction,
  WorkspaceShortcutHandlers,
} from "./use-workspace-shell.js";

export {
  dedupResize,
  createTerminalController,
  createDebouncedResize,
  TerminalSessionRegistry,
} from "./use-terminal-hooks.js";

export type {
  TerminalControllerOptions,
  TerminalController,
  TerminalSession,
  UseTerminalSessionResult,
  UseWorkspaceTerminalsResult,
} from "./use-terminal-hooks.js";

export {
  EXPLORER_QUERY_KEYS,
  useDirectoryListing,
  useFileContent,
  useDownloadToken,
  useGitStatus,
  useGitDiff,
  useGitBranches,
  usePrActivityQuery,
  useGitActions,
  subscribeFileWriteInvalidation,
} from "./use-explorer-hooks.js";

export {
  NAV_QUERY_KEYS,
  useSchedulesQuery,
  useScheduleHistory,
  useScheduleMutation,
  useProjectsQuery,
  useWorkspacesQuery,
  useProjectMutation,
  useNavigationStore,
  useHostConnections,
} from "./use-nav-hooks.js";

export type {
  Schedule,
  ScheduleRun,
  ScheduleTarget,
  ProjectRecord,
  WorkspaceRecord,
  CreateScheduleInput,
  UpdateScheduleInput,
  NavigationState,
  NavigationActions,
  NavigationStore,
  HostConnectionInfo,
  HostConnectionStatus,
  CollapsedSections,
} from "./use-nav-hooks.js";

export type {
  FileEntry,
  DirectoryListing,
  FileContent,
  GitStatus,
  GitDiff,
  GitHunk,
  GitDiffLine,
  GitBranch,
  GitAction,
  PrActivity,
  PrInfo,
  CommitInput,
  CheckoutInput,
  PushInput,
  StashInput,
} from "./use-explorer-hooks.js";
