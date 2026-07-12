export type PhantomPlayModerationState =
  | "draft"
  | "uploading"
  | "processing"
  | "automated_review"
  | "manual_review"
  | "changes_requested"
  | "approved"
  | "published"
  | "suspended"
  | "unpublished"
  | "rejected";

export type PhantomPlayRuntimeKind = "html5" | "javascript" | "webassembly" | "webgl" | "godot_web";
export type PhantomPlayAccessMode = "disabled" | "enabled" | "background_jobs_only" | "selected_hours";

export type PhantomPlayCreator = {
  id: string;
  displayName: string;
  tagline: string;
  verified: boolean;
};

export type PhantomPlayGame = {
  id: string;
  slug: string;
  title: string;
  creatorId: string;
  tagline: string;
  description: string;
  categories: string[];
  runtime: PhantomPlayRuntimeKind;
  moderationState: PhantomPlayModerationState;
  launchPath: string;
  averageMinutes: number;
  supportsKeyboard: boolean;
  supportsMouse: boolean;
  supportsTouch: boolean;
  supportsController: boolean;
  workplaceFriendly: boolean;
};

export type PhantomPlayOrgPolicy = {
  orgId: string;
  accessMode: PhantomPlayAccessMode;
  allowedRoles: string[];
  allowedHours: { start: string; end: string };
  maxSessionMinutes: number;
  dailyAllowanceMinutes: number;
  allowedCategories: string[];
  allowMultiplayer: boolean;
  allowLeaderboards: boolean;
  allowSocialFeatures: boolean;
  allowSound: boolean;
  usageReportingLevel: "summary" | "policy_only";
  forcePauseOnUrgentWork: boolean;
};

export type PhantomPlaySession = {
  id: string;
  gameId: string;
  userId: string;
  orgId: string;
  startedAt: string;
  lastActiveAt: string;
  status: "active" | "paused" | "ended";
  saveState?: Record<string, unknown>;
};

const creators: PhantomPlayCreator[] = [
  {
    id: "creator-phantomplay",
    displayName: "PhantomPlay Studio",
    tagline: "Original quick-session games from the Phantom lab.",
    verified: true,
  },
];

const games: PhantomPlayGame[] = [
  {
    id: "game-solitaire",
    slug: "solitaire",
    title: "Ghost Solitaire",
    creatorId: "creator-phantomplay",
    tagline: "Play like a ghost.",
    description:
      "A polished browser-first Solitaire flagship designed for quick breaks, save/resume, keyboard, mouse, touch, and reduced-motion support.",
    categories: ["cards", "short-session", "workplace-friendly", "brain-games"],
    runtime: "javascript",
    moderationState: "published",
    launchPath: "/phantomplay/runtime/solitaire",
    averageMinutes: 5,
    supportsKeyboard: true,
    supportsMouse: true,
    supportsTouch: true,
    supportsController: false,
    workplaceFriendly: true,
  },
];

const orgPolicies = new Map<string, PhantomPlayOrgPolicy>();
const sessions = new Map<string, PhantomPlaySession>();
const favorites = new Map<string, Set<string>>();

export function defaultPhantomPlayPolicy(orgId: string): PhantomPlayOrgPolicy {
  return {
    orgId,
    accessMode: "disabled",
    allowedRoles: ["owner", "admin"],
    allowedHours: { start: "12:00", end: "17:00" },
    maxSessionMinutes: 10,
    dailyAllowanceMinutes: 30,
    allowedCategories: ["cards", "short-session", "workplace-friendly", "brain-games"],
    allowMultiplayer: false,
    allowLeaderboards: false,
    allowSocialFeatures: false,
    allowSound: true,
    usageReportingLevel: "summary",
    forcePauseOnUrgentWork: true,
  };
}

export function getPhantomPlayPolicy(orgId: string) {
  if (!orgPolicies.has(orgId)) {
    orgPolicies.set(orgId, defaultPhantomPlayPolicy(orgId));
  }

  return orgPolicies.get(orgId)!;
}

export function updatePhantomPlayPolicy(orgId: string, patch: Partial<PhantomPlayOrgPolicy>) {
  const current = getPhantomPlayPolicy(orgId);
  const next = {
    ...current,
    ...patch,
    orgId,
    allowedRoles: patch.allowedRoles ?? current.allowedRoles,
    allowedHours: patch.allowedHours ?? current.allowedHours,
    allowedCategories: patch.allowedCategories ?? current.allowedCategories,
  };
  orgPolicies.set(orgId, next);
  return next;
}

export function listPhantomPlayGames() {
  return games.filter((game) => game.moderationState === "published");
}

export function listPhantomPlayCreators() {
  return creators;
}

export function getPhantomPlayGame(gameIdOrSlug: string) {
  return games.find((game) => game.id === gameIdOrSlug || game.slug === gameIdOrSlug);
}

export function getPhantomPlaySnapshot(orgId: string, userId: string) {
  const userFavorites = favorites.get(userId) ?? new Set<string>();
  const recentSessions = [...sessions.values()]
    .filter((session) => session.userId === userId)
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    .slice(0, 8);

  return {
    product: {
      name: "PhantomPlay",
      slogan: "Play like a ghost.",
      standalonePath: "/phantomplay",
      breakRoomLabel: "Take Five",
    },
    policy: getPhantomPlayPolicy(orgId),
    games: listPhantomPlayGames(),
    creators: listPhantomPlayCreators(),
    favorites: [...userFavorites],
    recentSessions,
    runtimeSecurity: {
      browserFirstOnly: true,
      acceptedRuntimes: ["html5", "javascript", "webassembly", "webgl", "godot_web"] satisfies PhantomPlayRuntimeKind[],
      rejectsExecutables: true,
      sandboxRequired: true,
      noAssetCloudCoupling: true,
    },
    creatorPublishingStates: [
      "draft",
      "uploading",
      "processing",
      "automated_review",
      "manual_review",
      "changes_requested",
      "approved",
      "published",
      "suspended",
      "unpublished",
      "rejected",
    ] satisfies PhantomPlayModerationState[],
  };
}

export function canUsePhantomPlay({
  orgId,
  role,
  hasActiveBackgroundJob,
  now = new Date(),
}: {
  orgId: string;
  role: string;
  hasActiveBackgroundJob: boolean;
  now?: Date;
}) {
  const policy = getPhantomPlayPolicy(orgId);

  if (policy.accessMode === "disabled") return { ok: false, reason: "PhantomPlay is disabled for this organization." };
  if (!policy.allowedRoles.includes(role)) return { ok: false, reason: "Your role is not enabled for PhantomPlay." };
  if (policy.accessMode === "background_jobs_only" && !hasActiveBackgroundJob) {
    return { ok: false, reason: "PhantomPlay is only enabled while background work is running." };
  }
  if (policy.accessMode === "selected_hours") {
    const current = now.toTimeString().slice(0, 5);
    if (current < policy.allowedHours.start || current > policy.allowedHours.end) {
      return { ok: false, reason: `PhantomPlay is available from ${policy.allowedHours.start} to ${policy.allowedHours.end}.` };
    }
  }

  return { ok: true, reason: "PhantomPlay access allowed." };
}

export function startPhantomPlaySession({
  gameId,
  orgId,
  userId,
}: {
  gameId: string;
  orgId: string;
  userId: string;
}) {
  const game = getPhantomPlayGame(gameId);
  if (!game) return null;

  const now = new Date().toISOString();
  const session: PhantomPlaySession = {
    id: `pps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    gameId: game.id,
    orgId,
    userId,
    startedAt: now,
    lastActiveAt: now,
    status: "active",
  };
  sessions.set(session.id, session);
  return session;
}

export function updatePhantomPlaySession(
  sessionId: string,
  patch: Partial<Pick<PhantomPlaySession, "status" | "saveState">>,
) {
  const current = sessions.get(sessionId);
  if (!current) return null;

  const next = {
    ...current,
    ...patch,
    lastActiveAt: new Date().toISOString(),
  };
  sessions.set(sessionId, next);
  return next;
}

export function togglePhantomPlayFavorite(userId: string, gameId: string) {
  const current = favorites.get(userId) ?? new Set<string>();
  if (current.has(gameId)) {
    current.delete(gameId);
  } else {
    current.add(gameId);
  }
  favorites.set(userId, current);
  return [...current];
}
