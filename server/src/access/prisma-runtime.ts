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
