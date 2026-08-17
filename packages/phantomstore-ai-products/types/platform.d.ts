export type AiProductsSession = {
  actorId: string;
  workspaceId: string;
  role: "viewer" | "reviewer" | "owner";
  displayName: string;
  subjectId?: string;
  authenticationStrength?: string;
  sessionExpiresAt?: string;
  capabilities?: string[];
};

export class PlatformError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;
}

export class JsonFileAdapter {
  constructor(filePath: string);
  read(): Promise<unknown>;
  write(document: Record<string, unknown>): Promise<void>;
}

export class AiProductsPlatform {
  constructor(options: { adapter: JsonFileAdapter; now?: () => string; id?: () => string; identityAdapter?: unknown });
  document: Record<string, any>;
  init(): Promise<this>;
  mutate<T>(operation: (document: Record<string, any>) => T | Promise<T>): Promise<T>;
  snapshot(session: AiProductsSession): Record<string, any>;
  setConsent(session: AiProductsSession, productId: string, input?: Record<string, unknown>): Promise<Record<string, any>>;
  createArtifact(session: AiProductsSession, productId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, any>>;
  updateArtifact(session: AiProductsSession, artifactId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, any>>;
  runAnalysis(session: AiProductsSession, artifactId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, any>>;
  reviewAnalysis(session: AiProductsSession, analysisId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, any>>;
  archiveArtifact(session: AiProductsSession, artifactId: string, restore?: boolean): Promise<Record<string, any>>;
  deleteArtifact(session: AiProductsSession, artifactId: string, confirmation: string): Promise<Record<string, any>>;
  exportArtifact(session: AiProductsSession, artifactId: string): Promise<Record<string, any>>;
}

export function initialDocument(now?: string): Record<string, any>;
