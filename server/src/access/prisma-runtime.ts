import { PrismaClient } from "@prisma/client";

export const prismaConfigured = Boolean(process.env.DATABASE_URL);
export const forceJsonRepository = process.env.PHANTOMFORCE_ACCESS_REPOSITORY === "json-file";
export const usePrisma = prismaConfigured && !forceJsonRepository;
export const prisma = usePrisma ? new PrismaClient() : undefined;
export const prismaStartupTimeoutMs = Number(process.env.PHANTOMFORCE_PRISMA_STARTUP_TIMEOUT_MS ?? 8000);

export async function withPrismaStartupTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Prisma/Postgres startup timed out after ${prismaStartupTimeoutMs}ms while ${label}. Refusing to serve with stale access state.`,
            ),
          );
        }, prismaStartupTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/* PHANTOMFORCE_AUTH_PROVIDER=database only means "Postgres auth is
   configured" — it says nothing about whether Postgres is actually up right
   now. Without this check, a misconfigured/unreachable DATABASE_URL on
   app.phantomforce.online still renders a working-looking customer login
   form that fails on submit. Cached briefly so every /sessions poll doesn't
   round-trip to Postgres. */
const REACHABILITY_CACHE_MS = 15_000;
const REACHABILITY_TIMEOUT_MS = 3_000;
let lastReachability: { ok: boolean; checkedAt: number } | null = null;

export async function isDatabaseReachable(): Promise<boolean> {
  if (!prisma) return false;
  const now = Date.now();
  if (lastReachability && now - lastReachability.checkedAt < REACHABILITY_CACHE_MS) {
    return lastReachability.ok;
  }
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("database_ping_timeout")), REACHABILITY_TIMEOUT_MS);
      }),
    ]);
    lastReachability = { ok: true, checkedAt: now };
    return true;
  } catch {
    lastReachability = { ok: false, checkedAt: now };
    return false;
  }
}

export function isDatabaseConnectivityError(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  const code = (error as { code?: string } | undefined)?.code;
  if (name === "PrismaClientInitializationError") return true;
  if (name === "PrismaClientKnownRequestError" && typeof code === "string") {
    return ["P1001", "P1002", "P1008", "P1017"].includes(code);
  }
  return false;
}
