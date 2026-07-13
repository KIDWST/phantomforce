import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/contenthub.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");

const tabBlock = source.match(/const tabs = \[([\s\S]*?)\];/u)?.[1] || "";
const expectedTabs = ["library", "ideas", "drafts", "publish", "calendar"];
const positions = expectedTabs.map((tab) => tabBlock.indexOf(`\"${tab}\"`));

assert.ok(positions.every((position) => position >= 0), "Content Hub must expose all five customer workflow tabs.");
assert.deepEqual([...positions].sort((a, b) => a - b), positions, "Content Hub tabs must follow Creation, Ideas, Drafts, Publish, Planner.");
assert.match(tabBlock, /\["library", "Creation"\]/u, "The old Library tab must be relabeled as Creation.");
assert.doesNotMatch(tabBlock, /Library/u, "Content Hub navigation must not present created media as a Library.");
assert.ok(!tabBlock.includes("production"), "The old Workflow/Production tab must not remain in navigation.");
assert.match(source, /renderContentCreation\(body, data, esc, el, opts\)/u, "Creation tab must route to the post-creation handoff surface.");
assert.match(source, /MEDIA_POOL_FILTERS = \[\["all", "All"\], \["image", "Images"\], \["video", "Videos"\]\]/u, "Creation filters must be Media Pool filters, not a content library taxonomy.");
assert.match(source, /Use Media Lab Media Pool assets to build organized posts/u, "Creation must explain that Media Pool remains the source of created media.");
assert.match(source, /data-ch-creator-source/u, "Creation must let users choose a Media Pool source for a post.");
assert.match(source, /Loaded the Media Pool source into Post Creator/u, "Choosing a source must hand off to the post creator, not a media library.");
assert.match(source, /publishUnifiedPreview\(selectedPlatforms,/u, "Publish must render one unified destination preview.");
assert.doesNotMatch(source, /selectedPlatforms\.map\(\(id\)\s*=>\s*publishPlatformPreview/u, "Publish must not render duplicate platform previews.");
assert.match(source, /BUSINESS PLANNER/u, "Planner page must be implemented.");
assert.match(source, /Gmail/u);
assert.match(source, /Proton Mail/u);
assert.match(source, /Google Calendar/u);
assert.match(source, /Calendly/u);
assert.match(source, /workspaceStorageSetItem\(CH_PLANNER_ITEMS_KEY/u, "Planner items must use workspace-isolated persistence.");
assert.match(css, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/u, "Mobile workflow tabs must remain in one ordered row.");
assert.match(css, /\.workspace-page-first\[data-workspace-page="content"\][\s\S]*?\.media-suite-body\s*\{[\s\S]*?overflow:\s*visible/u, "Content Hub must scroll inside the full-page Media Lab shell instead of being clipped.");

console.log("Content Hub planner checks passed.");
