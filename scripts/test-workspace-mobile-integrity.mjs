import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const index = read("../app/index.html");
const css = read("../app/workspace-mobile-integrity.css");

const integrityLink = index.indexOf("/app/workspace-mobile-integrity.css");
const commandOsLink = index.indexOf("/app/command-os.css");
const siteResponsiveLink = index.indexOf("/app/site-studio-responsive.css");

assert.ok(integrityLink > commandOsLink, "Mobile integrity CSS must load after command-os.css.");
assert.ok(integrityLink > siteResponsiveLink, "Mobile integrity CSS must be the final workspace layout authority.");

assert.match(css, /@media \(max-width: 980px\)/u, "Phone and tablet layouts need a shared integrity boundary.");
assert.match(css, /data-workspace-page="leads"[\s\S]*?\.crm-layout[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/u, "Clients must collapse to one intrinsic-width column.");
assert.match(css, /data-workspace-page="leads"[\s\S]*?\.crm-next[\s\S]*?white-space:\s*normal\s*!important/u, "Client next actions must wrap instead of creating hidden width.");
assert.match(css, /data-workspace-page="sites"[\s\S]*?\.ss-simple-top[\s\S]*?display:\s*grid/u, "Website Builder selector controls must stack on mobile.");
assert.match(css, /data-workspace-page="sites"[\s\S]*?\.ss-simple-sites[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u, "Website cards must use intrinsic responsive tracks.");
assert.match(css, /data-workspace-page="media"[\s\S]*?\.ml-tabs[\s\S]*?flex-wrap:\s*wrap/u, "Media Lab tabs must wrap instead of becoming a nested horizontal scroller.");
assert.match(css, /data-workspace-page="media"[\s\S]*?\.ml-idle[\s\S]*?overflow:\s*hidden/u, "Media Lab decoration must not expand the stage scroll width.");
assert.match(css, /data-workspace-page="automation"[\s\S]*?\.au-row-main p[\s\S]*?white-space:\s*normal\s*!important/u, "Automation descriptions must remain readable on phones.");
assert.match(css, /data-workspace-page="phantomplay"[\s\S]*?\.pp-top > \.pp-tabs[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u, "PhantomPlay navigation must fit without horizontal scrolling.");
assert.match(css, /data-workspace-page="phantomplay"[\s\S]*?\.pp-game-art::before[\s\S]*?inset:\s*0\s*!important/u, "PhantomPlay art effects must stay inside their cards.");
assert.match(css, /data-workspace-page="phantomstore"[\s\S]*?\.ps-categories[\s\S]*?flex-wrap:\s*wrap/u, "PhantomStore categories must remain visible without horizontal scrolling.");

console.log("Workspace mobile integrity checks passed.");
