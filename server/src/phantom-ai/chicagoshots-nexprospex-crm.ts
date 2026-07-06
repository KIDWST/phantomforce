import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_NEXPROSPEX_ROOT =
  "C:\\Users\\jorda\\Documents\\JORDAN_COMPLETE_AI_HANDOFF\\projects\\NexProspex-CRM-OS";
const MAX_CONTACTS = 75;

type JsonRecord = Record<string, unknown>;

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

function nexprospexRoot() {
  return process.env.NEXPROSPEX_CRM_ROOT?.trim() || DEFAULT_NEXPROSPEX_ROOT;
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
    readiness: str(row.outreach_readiness ?? row.workflow_status) || "Review",
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

export async function getChicagoShotsNexProspexCrm(limit = 25) {
  const paths = sourcePaths();
  const contactLimit = Math.max(1, Math.min(MAX_CONTACTS, Math.floor(limit || 25)));
  const [leadRows, orgRows] = await Promise.all([
    readJsonArray(paths.leads),
    readJsonArray(paths.organizations),
  ]);
  const contacts = leadRows.map(mapContact).sort(sortContacts);
  const organizations = orgRows.map(mapOrganization)
    .sort((a, b) => b.pipeline_value - a.pipeline_value || b.average_score - a.average_score);
  const openPipeline = contacts.reduce((sum, contact) => sum + contact.pipeline_value, 0);
  const immediate = contacts.filter((contact) => /immediate|ready/i.test(contact.readiness)).length;
  const followUps = contacts.filter((contact) => /follow|sequence|due/i.test(contact.follow_up)).length;
  const verified = contacts.filter((contact) => contact.verified).length;

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
      source_of_truth: "local NexProspex CRM export",
    },
    service_tier: {
      active_for_admin: "Elite",
      client_tiers: [
        {
          id: "basic",
          name: "Basic",
          summary: "Lead lists, simple scraping/import, follow-up drafts, and monthly scan proof.",
          best_for: "Small local business that needs a clean pipeline.",
        },
        {
          id: "premiere",
          name: "Premiere",
          summary: "CRM, follow-ups, booking, content planning, review requests, website/store support.",
          best_for: "Business that wants PhantomForce running the growth desk.",
        },
        {
          id: "elite",
          name: "Elite",
          summary: "Full admin package: CRM, media, automations, security, sites/stores, analytics, and operator controls.",
          best_for: "Jordan/PhantomForce testing the highest package before selling it.",
        },
      ],
    },
    summary: {
      contacts_total: contacts.length,
      organizations_total: organizations.length,
      verified_contacts: verified,
      immediate_opportunities: immediate,
      follow_ups_due_or_ready: followUps,
      open_pipeline_value: openPipeline,
      average_score: contacts.length
        ? Math.round(contacts.reduce((sum, contact) => sum + contact.priority_score, 0) / contacts.length)
        : 0,
    },
    contacts: contacts.slice(0, contactLimit),
    organizations: organizations.slice(0, Math.min(15, contactLimit)),
    safety: {
      workspace_scoped: true,
      copied_into_repo: false,
      external_send: false,
      outreach_executed: false,
      source_data_mutated: false,
      credentials_returned: false,
    },
  };
}
