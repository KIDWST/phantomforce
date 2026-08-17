const clone = (value) => structuredClone(value);

function requireWorkspace(workspaceId) {
  if (!workspaceId || typeof workspaceId !== "string") throw new TypeError("A workspaceId predicate is mandatory for repository access.");
  return workspaceId;
}

class ScopedRepository {
  constructor(document, collection) { this.document = document; this.collection = collection; }
  rows() { return this.document[this.collection]; }
  get(workspaceId, id, { includeDeleted = false } = {}) {
    requireWorkspace(workspaceId);
    return this.rows().find((row) => row.workspaceId === workspaceId && row.id === id && (includeDeleted || !row.deletedAt)) || null;
  }
  list(workspaceId, predicate = () => true) {
    requireWorkspace(workspaceId);
    return this.rows().filter((row) => row.workspaceId === workspaceId && predicate(row));
  }
  insert(workspaceId, row) {
    requireWorkspace(workspaceId);
    if (row.workspaceId !== workspaceId) throw new TypeError("Repository insert workspace predicate does not match the row.");
    this.rows().push(row); return row;
  }
}

export class ArtifactRepository extends ScopedRepository {
  constructor(document) { super(document, "artifacts"); }
  remove(workspaceId, id) {
    requireWorkspace(workspaceId); const index = this.rows().findIndex((row) => row.workspaceId === workspaceId && row.id === id);
    if (index < 0) return null; return this.rows().splice(index, 1)[0];
  }
}
export class AnalysisRepository extends ScopedRepository {
  constructor(document) { super(document, "analyses"); }
  forArtifact(workspaceId, artifactId) { return this.list(workspaceId, (row) => row.artifactId === artifactId); }
}
export class JobRepository extends ScopedRepository { constructor(document) { super(document, "jobs"); } }
export class SourceRepository extends ScopedRepository { constructor(document) { super(document, "sources"); } }
export class ConsentRepository extends ScopedRepository {
  constructor(document) { super(document, "consentRecords"); }
  activeForProduct(workspaceId, productId) { return this.list(workspaceId, (row) => row.productId === productId && row.status === "granted").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null; }
}
export class AuditRepository extends ScopedRepository { constructor(document) { super(document, "audit"); } }
export class MetricRepository extends ScopedRepository { constructor(document) { super(document, "metrics"); } }
export class TraceRepository extends ScopedRepository { constructor(document) { super(document, "traces"); } }
export class VersionRepository {
  constructor(document) { this.document = document; }
  append(workspaceId, artifactId, version) {
    requireWorkspace(workspaceId); const artifact = this.document.artifacts.find((row) => row.workspaceId === workspaceId && row.id === artifactId && !row.deletedAt);
    if (!artifact) return null; artifact.versionHistory ||= []; artifact.versionHistory.push(version); return version;
  }
  list(workspaceId, artifactId) {
    requireWorkspace(workspaceId); const artifact = this.document.artifacts.find((row) => row.workspaceId === workspaceId && row.id === artifactId);
    return clone(artifact?.versionHistory || []);
  }
}

export function createRepositoryHub(document) {
  return Object.freeze({
    artifacts: new ArtifactRepository(document), analyses: new AnalysisRepository(document), jobs: new JobRepository(document),
    consents: new ConsentRepository(document), sources: new SourceRepository(document), audit: new AuditRepository(document),
    metrics: new MetricRepository(document), traces: new TraceRepository(document), versions: new VersionRepository(document)
  });
}

export class RelationalRepositoryBoundary {
  constructor({ client = null } = {}) { this.client = client; this.enabled = Boolean(client); }
  describe() {
    return {
      kind: "relational_repository_boundary", enabled: this.enabled, tenantPredicate: "workspaceId/orgId required on every read and mutation",
      transactionRequiredFor: ["artifact+version", "analysis+job", "consent+dependency", "delete+audit"],
      repositories: ["artifact", "analysis", "job", "consent", "source", "audit", "metric", "version"]
    };
  }
  async transaction() {
    if (!this.enabled) throw new Error("RELATIONAL_ADAPTER_DISABLED");
    throw new Error("A repository-specific Prisma transaction implementation is required before enabling this boundary.");
  }
}

export const RepositoryContract = Object.freeze({
  version: 1,
  mandatoryScope: ["workspaceId"],
  operations: ["get", "list", "insert", "update_with_expected_revision", "delete_with_policy", "transaction"]
});
