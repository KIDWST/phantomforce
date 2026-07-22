import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const main = read("app/js/main.js");
const organization = read("app/js/organization.js");
const settings = read("app/js/settings.js");
const registry = read("server/src/customization/module-registry.ts");

assert.match(main, /id: "crm",\s+label: "Clients",\s+icon: "users", ws: "leads"/u,
  "Clients must remain a visible client-pipeline destination.");
assert.doesNotMatch(main, /id: "crm"[^\n]*navHidden/u,
  "Clients must not be hidden with the retired Client Setup surface.");
assert.match(main, /crm: "Clients"/u,
  "Mobile navigation must call the pipeline Clients, not Client Setup or Leads.");
assert.doesNotMatch(main, /id: "clientsetup"|label: "Client Setup"/iu,
  "Client Setup must not return as a primary navigation module.");

assert.match(settings, /id: "organization", label: "Organization", category: "Workspace"/u,
  "Organization management must live under the Workspace settings category.");
assert.match(settings, /id: "plan", label: "Plan & access", category: "Workspace"/u,
  "Plan testing and entitlement restrictions must live under Settings, not Clients.");
assert.match(settings, /id: "workspace", label: "Workspace Studio", category: "Workspace"/u,
  "Workspace Studio must remain in the same Settings category.");
assert.match(settings, /id: "bridge", label: "ChatGPT Bridge", category: "AI Brain"/u,
  "ChatGPT Bridge setup belongs in AI Brain settings.");
assert.match(settings, /\/phantom-ai\/agent-assist\/status/u,
  "Settings must read the universal agent assist bridge status.");
assert.match(settings, /ChatGPT app subscriptions and OpenAI API usage are separate billing paths/u,
  "Settings must explain that ChatGPT app subscriptions are not the API billing path.");
assert.match(settings, /OPENAI_API_KEY/u,
  "Settings must expose the OpenAI API key setup path without capturing secrets.");
assert.match(settings, /Do not paste ChatGPT passwords here/u,
  "Settings must forbid ChatGPT password capture.");
assert.match(settings, /data-agent-assist-refresh/u,
  "Settings must let the owner refresh bridge status.");
assert.match(settings, /renderOrganizationPanel\(organizationMount, opts\)/u,
  "Settings must mount the real Organization panel.");
assert.match(settings, /title: "Organization & access"/u,
  "Organization settings need a clear context-specific heading.");

assert.match(organization, /<h3>People &amp; access<\/h3>/u,
  "Organization must present people and access, not client setup.");
assert.match(organization, /Members \(\$\{orgState\.members\.length\}\)/u,
  "Organization must expose real members.");
assert.match(organization, /data-org-invite-form/u,
  "Organization must preserve employee invitations.");
assert.match(organization, /data-org-matrix/u,
  "Organization must preserve role-based module access.");
assert.match(organization, /const canManageOrganization/u,
  "Organization controls need an explicit management permission gate.");
assert.doesNotMatch(organization, /Client setup|Clients &amp; CRM|data-open-ws="leads"/iu,
  "Organization must not contain the retired CRM shortcut or Client Setup framing.");
assert.match(main, /<button class="plan-inner" data-open-ws="settings">[\s\S]*No real work loaded yet\./u,
  "The empty setup CTA must open Settings, not the client pipeline.");
assert.doesNotMatch(main, /<button class="plan-inner" data-open-ws="leads">[\s\S]*No real work loaded yet\./u,
  "The empty setup CTA must not route organization setup back into Clients.");

assert.match(registry, /id: "crm", displayName: "Clients"/u,
  "The server module registry must retain the canonical Clients label.");
assert.doesNotMatch(registry, /id: "clientsetup"|displayName: "Client Setup"/iu,
  "The retired Client Setup module must not return server-side.");

console.log("Organization Settings boundary checks passed.");
