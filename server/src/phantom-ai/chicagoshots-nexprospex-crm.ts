import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CURRENT_NEXPROSPEX_ROOT =
  "C:\\Users\\jorda\\Documents\\Codex\\2026-06-09\\can-you-view-my-spreadsheets-and\\work";
const LEGACY_NEXPROSPEX_ROOT =
  "C:\\Users\\jorda\\Documents\\JORDAN_COMPLETE_AI_HANDOFF\\projects\\NexProspex-CRM-OS";
const MAX_CONTACTS = 75;

type JsonRecord = Record<string, unknown>;
type SqlRow = Record<string, string | number | null>;

export type ChicagoShotsCrmContact = {
  id: string;
  name: string;
  organization: string;
  role: string;
  city: string;
  state: string;
  sport: string;
  email: string | null;
  instagram: string | null;
  website: string | null;
  priority_score: number;
  priority_tier: string;
  stage: string;
  readiness: string;
  pipeline_value: number;
  follow_up: string;
  source: string;
  verified: boolean;
  last_updated: string | null;
};

export type ChicagoShotsCrmOrganization = {
  id: string;
  name: string;
  city: string;
  state: string;
  category: string;
  website: string | null;
  contacts: number;
  average_score: number;
  pipeline_value: number;
};

export type ChicagoShotsFollowUpCandidate = {
  task_id: string;
  contact_id: string;
  name: string;
  organization: string;
  role: string;
  sport: string;
  email: string | null;
  instagram: string | null;
  follow_up_number: number;
  due_at: string;
  task_status: string;
  sequence_status: string;
  last_subject: string;
  priority_score: number;
  priority_tier: string;
  pipeline_value: number;
};

function candidateRoots() {
  return [
    process.env.NEXPROSPEX_CRM_ROOT?.trim(),
    CURRENT_NEXPROSPEX_ROOT,
    LEGACY_NEXPROSPEX_ROOT,
  ].filter((value): value is string => Boolean(value));
}

function nexprospexRoot() {
  return candidateRoots().find((root) => existsSync(path.join(root, "storage", "nexprospex.sqlite")))
    || candidateRoots().find((root) => existsSync(path.join(root, "src", "data", "leads.json")))
    || CURRENT_NEXPROSPEX_ROOT;
}

function sourcePaths() {
  const root = nexprospexRoot();
  return {
    root,
    leads: path.join(root, "src", "data", "leads.json"),
    organizations: path.join(root, "src", "data", "organizations.json"),
    sqlite: path.join(root, "storage", "nexprospex.sqlite"),
  };
}

async function readJsonArray(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed as JsonRecord[] : [];
}

function str(value: unknown) {
  const text = String(value ?? "").trim();
  return text && text !== "N/A" ? text : null;
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapContact(row: JsonRecord): ChicagoShotsCrmContact {
  return {
    id: str(row.lead_id) || str(row.id) || `nexprospex-${str(row.name) || "contact"}`,
    name: str(row.name) || "Unnamed contact",
    organization: str(row.organization) || str(row.organization_name) || "Unknown organization",
    role: str(row.role) || "Contact",
    city: str(row.city) || "",
    state: str(row.state) || "",
    sport: str(row.sport) || "",
    email: str(row.email),
    instagram: str(row.instagram),
    website: str(row.website),
    priority_score: num(row.lead_score ?? row.priority_score),
    priority_tier: str(row.priority_tier) || "Unranked",
    stage: str(row.altv_stage ?? row.outreach_stage) || "Lead / Cold",
    readiness: str(row.outreach_readiness ?? row.workflow_status ?? row.contact_status) || "Review",
    pipeline_value: num(row.pipeline_value),
    follow_up: str(row.follow_up_label) || str(row.follow_up_state) || str(row.outreach_readiness) || "Review next step",
    source: str(row.lead_source) || "NexProspex",
    verified: /verified/i.test(str(row.verification_status) || "") || num(row.confidence_score) >= 75,
    last_updated: str(row.last_updated ?? row.updated_at ?? row.created_at),
  };
}

function mapOrganization(row: JsonRecord): ChicagoShotsCrmOrganization {
  return {
    id: str(row.organization_id) || str(row.id) || `nexprospex-org-${str(row.name) || "org"}`,
    name: str(row.name) || "Unknown organization",
    city: str(row.city) || "",
    state: str(row.state) || "",
    category: str(row.subcategory ?? row.sport) || "Sports organization",
    website: str(row.website),
    contacts: num(row.total_contacts),
    average_score: num(row.average_lead_score ?? row.revenue_priority),
    pipeline_value: num(row.pipeline_value),
  };
}

function sortContacts(a: ChicagoShotsCrmContact, b: ChicagoShotsCrmContact) {
  return (
    b.pipeline_value - a.pipeline_value ||
    b.priority_score - a.priority_score ||
    a.organization.localeCompare(b.organization)
  );
}

function scalar(db: DatabaseSync, sql: string) {
  const row = db.prepare(sql).get() as SqlRow | undefined;
  return num(row?.value);
}

function loadSqliteCrm(paths: ReturnType<typeof sourcePaths>, contactLimit: number) {
  const db = new DatabaseSync(paths.sqlite, { readOnly: true });
  try {
    const contactRows = db.prepare(`
      SELECT id, name, organization_name, role, city, state, sport, email, instagram, website,
        priority_score, priority_tier, outreach_stage, contact_status, pipeline_value, lead_source,
        confidence_score, updated_at
      FROM contacts
      WHERE archived_at IS NULL
      ORDER BY pipeline_value DESC, priority_score DESC, organization_name ASC
      LIMIT ?
    `).all(contactLimit) as SqlRow[];
    const organizationRows = db.prepare(`
      SELECT o.id, o.name, o.city, o.state, COALESCE(o.subcategory, o.sport, 'Organization') AS category,
        o.website, COUNT(c.id) AS total_contacts, COALESCE(AVG(c.priority_score), o.revenue_priority, 0) AS average_score,
        COALESCE(SUM(c.pipeline_value), 0) AS pipeline_value
      FROM organizations o
      LEFT JOIN contacts c ON c.organization_id = o.id AND c.archived_at IS NULL
      WHERE o.archived_at IS NULL
      GROUP BY o.id
      ORDER BY pipeline_value DESC, average_score DESC, o.name ASC
      LIMIT 15
    `).all() as SqlRow[];
    const followUpRows = db.prepare(`
      SELECT f.id AS task_id, f.contact_id, c.name, c.organization_name, c.role, c.sport, c.email,
        c.instagram, f.follow_up_number, f.due_at, f.status AS task_status,
        s.status AS sequence_status, COALESCE(a.subject, '') AS last_subject,
        c.priority_score, c.priority_tier, c.pipeline_value
      FROM follow_up_tasks f
      JOIN contacts c ON c.id = f.contact_id
      JOIN outreach_sequences s ON s.id = f.sequence_id
      LEFT JOIN outreach_attempts a ON a.id = (
        SELECT a2.id FROM outreach_attempts a2
        WHERE a2.contact_id = c.id
        ORDER BY datetime(a2.created_at) DESC LIMIT 1
      )
      WHERE f.status IN ('Scheduled', 'Awaiting Intro') AND c.archived_at IS NULL
      ORDER BY datetime(f.due_at) ASC, c.priority_score DESC
      LIMIT 40
    `).all() as SqlRow[];

    const contacts = contactRows.map((row) => mapContact({
      ...row,
      readiness: row.contact_status,
      follow_up_label: "Tracked in NexProspex sequence",
    }));
    const organizations = organizationRows.map((row) => mapOrganization({
      ...row,
      subcategory: row.category,
      average_lead_score: row.average_score,
    }));
    const followUpCandidates: ChicagoShotsFollowUpCandidate[] = followUpRows.map((row) => ({
      task_id: str(row.task_id) || "",
      contact_id: str(row.contact_id) || "",
      name: str(row.name) || "Contact",
      organization: str(row.organization_name) || "Organization",
      role: str(row.role) || "Contact",
      sport: str(row.sport) || "",
      email: str(row.email),
      instagram: str(row.instagram),
      follow_up_number: num(row.follow_up_number),
      due_at: str(row.due_at) || new Date().toISOString(),
      task_status: str(row.task_status) || "Scheduled",
      sequence_status: str(row.sequence_status) || "Active",
      last_subject: str(row.last_subject) || "ChicagoShots media support",
      priority_score: num(row.priority_score),
      priority_tier: str(row.priority_tier) || "Unranked",
      pipeline_value: num(row.pipeline_value),
    }));

    return {
      contacts,
      organizations,
      followUpCandidates,
      summary: {
        contacts_total: scalar(db, "SELECT COUNT(*) AS value FROM contacts WHERE archived_at IS NULL"),
        organizations_total: scalar(db, "SELECT COUNT(*) AS value FROM organizations WHERE archived_at IS NULL"),
        verified_contacts: scalar(db, "SELECT COUNT(*) AS value FROM contacts WHERE archived_at IS NULL AND confidence_score >= 75"),
        immediate_opportunities: scalar(db, "SELECT COUNT(*) AS value FROM contacts WHERE archived_at IS NULL AND (priority_tier LIKE 'Tier 1:%' OR priority_score >= 100)"),
        follow_ups_due_or_ready: scalar(db, "SELECT COUNT(*) AS value FROM follow_up_tasks WHERE status IN ('Scheduled', 'Awaiting Intro')"),
        follow_ups_overdue: scalar(db, "SELECT COUNT(*) AS value FROM follow_up_tasks WHERE status = 'Scheduled' AND datetime(due_at) <= datetime('now')"),
        active_sequences: scalar(db, "SELECT COUNT(*) AS value FROM outreach_sequences WHERE status IN ('Active', 'Initial Sent', 'Queued')"),
        responses_received: scalar(db, "SELECT COUNT(*) AS value FROM outreach_attempts WHERE response_received_at IS NOT NULL"),
        suppressed_contacts: scalar(db, "SELECT COUNT(*) AS value FROM suppression_list WHERE released_at IS NULL"),
        open_pipeline_value: scalar(db, "SELECT COALESCE(SUM(pipeline_value), 0) AS value FROM contacts WHERE archived_at IS NULL"),
        average_score: Math.round(scalar(db, "SELECT COALESCE(AVG(priority_score), 0) AS value FROM contacts WHERE archived_at IS NULL")),
      },
    };
  } finally {
    db.close();
  }
}

async function loadJsonFallback(paths: ReturnType<typeof sourcePaths>, contactLimit: number) {
  const [leadRows, orgRows] = await Promise.all([
    readJsonArray(paths.leads),
    readJsonArray(paths.organizations),
  ]);
  const allContacts = leadRows.map(mapContact).sort(sortContacts);
  const organizations = orgRows.map(mapOrganization)
    .sort((a, b) => b.pipeline_value - a.pipeline_value || b.average_score - a.average_score);
  return {
    contacts: allContacts.slice(0, contactLimit),
    organizations: organizations.slice(0, Math.min(15, contactLimit)),
    followUpCandidates: [] as ChicagoShotsFollowUpCandidate[],
    summary: {
      contacts_total: allContacts.length,
      organizations_total: organizations.length,
      verified_contacts: allContacts.filter((contact) => contact.verified).length,
      immediate_opportunities: allContacts.filter((contact) => /immediate|ready/i.test(contact.readiness)).length,
      follow_ups_due_or_ready: allContacts.filter((contact) => /follow|sequence|due/i.test(contact.follow_up)).length,
      follow_ups_overdue: 0,
      active_sequences: 0,
      responses_received: 0,
      suppressed_contacts: 0,
      open_pipeline_value: allContacts.reduce((sum, contact) => sum + contact.pipeline_value, 0),
      average_score: allContacts.length
        ? Math.round(allContacts.reduce((sum, contact) => sum + contact.priority_score, 0) / allContacts.length)
        : 0,
    },
  };
}

export async function getChicagoShotsNexProspexCrm(limit = 25) {
  const paths = sourcePaths();
  const contactLimit = Math.max(1, Math.min(MAX_CONTACTS, Math.floor(limit || 25)));
  const sqliteAvailable = existsSync(paths.sqlite);
  const data = sqliteAvailable
    ? loadSqliteCrm(paths, contactLimit)
    : await loadJsonFallback(paths, contactLimit);

  return {
    ok: true,
    workspace_id: "chicagoshots",
    business: "ChicagoShots",
    managed_by: "PhantomForce",
    source: {
      system: "NexProspex CRM",
      root: paths.root,
      leads_file: paths.leads,
      organizations_file: paths.organizations,
      sqlite_file: paths.sqlite,
      source_of_truth: sqliteAvailable ? "live local NexProspex SQLite (read-only)" : "local NexProspex JSON export fallback",
      freshness: sqliteAvailable ? "live on refresh" : "export snapshot",
    },
    service_tier: {
      active_for_admin: "Elite",
      client_tiers: [
        { id: "basic", name: "Basic", summary: "Lead lists, simple imports, follow-up drafts, and monthly scan proof." },
        { id: "premiere", name: "Premiere", summary: "CRM, follow-ups, booking, content planning, reviews, and website support." },
        { id: "elite", name: "Elite", summary: "CRM, media, automations, security, sites, analytics, and operator controls." },
      ],
    },
    summary: data.summary,
    contacts: data.contacts,
    organizations: data.organizations,
    follow_up_candidates: data.followUpCandidates,
    safety: {
      workspace_scoped: true,
      copied_into_repo: false,
      external_send: false,
      outreach_executed: false,
      source_data_mutated: false,
      database_opened_read_only: sqliteAvailable,
      credentials_returned: false,
    },
  };
}
