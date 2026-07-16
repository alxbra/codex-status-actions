export type ThreadVisualState = "idle" | "unread" | "working" | "needs-user" | "error";

export type AssignmentMode = "recent";

export interface ThreadRecord {
  id: string;
  title: string;
  cwd?: string;
  updatedAt: number;
  parentThreadId?: string;
  archived: boolean;
  ephemeral?: boolean;
}

export interface ThreadRuntimeState {
  working: boolean;
  needsUser: boolean;
  error: boolean;
  turnId?: string;
  changedAt: number;
  lastCompletionId?: string;
  lastAcknowledgedCompletionId?: string;
}

export interface ThreadStatusSnapshot {
  thread: ThreadRecord;
  state: ThreadVisualState;
  turnId?: string;
  changedAt: number;
  unreadCompletionId?: string;
}

export interface HookEnvelope {
  version: 1;
  event: "permission-requested" | "question-opened" | "question-closed";
  threadId: string;
  turnId?: string;
  timestamp: number;
}

export type HookTrustStatus = "missing" | "untrusted" | "trusted" | "modified" | "disabled" | "error";

export interface HealthSnapshot {
  codexBinary: "checking" | "available" | "missing";
  catalog: "connecting" | "connected" | "disconnected";
  rolloutWatcher: "starting" | "watching" | "error";
  hooks: HookTrustStatus;
  navigation: "unchecked" | "available" | "error";
  restartRequired: boolean;
  message?: string;
}

export interface PersistedThreadState {
  lastCompletionId?: string;
  lastAcknowledgedCompletionId?: string;
  error?: boolean;
  changedAt?: number;
}

export interface GlobalSettings {
  assignmentMode: AssignmentMode;
  enhancedStatusEnabled: boolean;
  codexHome?: string;
  initialized?: boolean;
  threadStates?: Record<string, PersistedThreadState>;
  rolloutOffsets?: Record<string, number>;
}

export interface PropertyInspectorSnapshot {
  type: "snapshot";
  settings: GlobalSettings;
  health: HealthSnapshot;
  hookCount: number;
  codexHome: string;
  version: string;
}

export type PropertyInspectorCommand =
  | { type: "refresh" }
  | { type: "trust-hooks" }
  | { type: "reinstall-hooks" }
  | { type: "set-enhanced-status"; enabled: boolean }
  | { type: "set-codex-home"; path?: string }
  | { type: "copy-diagnostics" };

export interface CodexStatusProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): ReadonlyMap<string, ThreadStatusSnapshot>;
  subscribe(listener: () => void): () => void;
}
