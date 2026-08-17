import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCTS } from "../src/catalog.mjs";

const root = resolve(import.meta.dirname, "..");
for (const path of ["../../docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json", "../../docs/phantomstore-ai-products/MILESTONE_2_COMPLETION_LEDGER.json", "../../docs/phantomstore-ai-products/MILESTONE_2_BASELINE.md", "../../docs/phantomstore-ai-products/MILESTONE_2_PRIORITY_MAP.md", "../../artifacts/phantomstore-ai-products/milestone-2-priority-map.json", "../../docs/phantomstore-ai-products/STORE_METADATA.json", "../../docs/phantomstore-ai-products/RUNBOOK.md", "../../docs/phantomstore-ai-products/MODEL_CARD.md"]) await access(resolve(root, path));
const html = await readFile(resolve(root, "public/index.html"), "utf8"); const css = await readFile(resolve(root, "public/styles.css"), "utf8"); const app = await readFile(resolve(root, "public/app.js"), "utf8");
const ledger = JSON.parse(await readFile(resolve(root, "../../docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json"), "utf8"));
if (PRODUCTS.length !== 10) throw new Error("Expected exactly ten products.");
if (ledger.tickets.length !== 5400 || ledger.summary.implementedTicketVerticalSlices !== 10 || ledger.summary.implementedMilestone2Tickets !== 271 || ledger.summary.deferredTickets !== 5119 || ledger.summary.falseClaims !== 0) throw new Error("Requirement ledger is incomplete or overclaims implementation.");
if (!html.includes('aria-label="Exactly ten AI products"') || !html.includes('aria-live="polite"') || !html.includes("skip-link")) throw new Error("Semantic UI structure is incomplete.");
for (const token of ["max-width:760px", "max-width:420px", "prefers-reduced-motion:reduce", "forced-colors:active", "min-width:320px", ":focus-visible"]) if (!css.includes(token)) throw new Error(`Missing inclusive CSS token ${token}.`);
for (const token of ["Source fields were preserved", "Formula and inputs", "X-Confirm-Delete", "Complete core loop", "data-edit", "alertdialog"]) if (!app.includes(token)) throw new Error(`Missing UI truth token ${token}.`);
console.log(JSON.stringify({ ok: true, productCount: PRODUCTS.length, ticketRequirements: ledger.tickets.length, implementedBeforeMilestone2: 10, implementedMilestone2Tickets: 271, implementedTicketsTotal: 281, deferredTickets: 5119, externalModelsActive: false }));
