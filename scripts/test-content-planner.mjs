import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/contenthub.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");

const tabBlock = source.match(/const tabs = \[([\s\S]*?)\];/u)?.[1] || "";
const expectedTabs = ["ideas", "drafts", "publish", "calendar"];
const positions = expectedTabs.map((tab) => tabBlock.indexOf(`\"${tab}\"`));

assert.ok(positions.every((position) => position >= 0), "Content Hub must expose the four posting workflow tabs.");
assert.deepEqual([...positions].sort((a, b) => a - b), positions, "Content Hub tabs must follow Ideas, Drafts, Publish, Planner.");
assert.doesNotMatch(tabBlock, /library|Library|Creation/u, "Content Hub navigation must not present created media as a Library/Creation tab.");
assert.ok(!tabBlock.includes("production"), "The old Workflow/Production tab must not remain in navigation.");
assert.match(source, /const chState = \{ tab: "publish"/u, "Content Hub should open on the Publish composer by default.");
assert.match(source, /requestedTab === "library"\) chState\.tab = "publish"/u, "Old library deep links must land on Publish.");
assert.match(source, /PUBLISH_FORMATS/u, "Publish must include explicit post type selection.");
assert.match(source, /data-ch-pub-drop/u, "Publish must support drag-and-drop source files.");
assert.match(source, /data-ch-pub-pc/u, "Publish must support selecting source files from the PC.");
assert.match(source, /data-ch-pub-enhance-brief/u, "Publish must include AI enhance for the post description.");
assert.match(source, /data-ch-pub-post-now/u, "Publish must include a post-now action.");
assert.match(source, /status === "posted"[\s\S]*?addPublishPosts\(data, draft, "published"\)/u, "Post now must write published local content records for analytics visibility.");
assert.match(source, /publishUnifiedPreview\(selectedPlatforms,/u, "Publish must render one unified destination preview.");
assert.doesNotMatch(source, /selectedPlatforms\.map\(\(id\)\s*=>\s*publishPlatformPreview/u, "Publish must not render duplicate platform previews.");
assert.match(source, /BUSINESS PLANNER/u, "Planner page must be implemented.");
assert.match(source, /Gmail/u);
assert.match(source, /Proton Mail/u);
assert.match(source, /Google Calendar/u);
assert.match(source, /Calendly/u);
assert.match(source, /workspaceStorageSetItem\(CH_PLANNER_ITEMS_KEY/u, "Planner items must use workspace-isolated persistence.");
assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/u, "Mobile workflow tabs must remain in one ordered four-tab row.");
assert.match(css, /\.ch-pub-drop/u, "Publish drop zone must be styled.");
assert.match(css, /\.workspace-page-first\[data-workspace-page="content"\][\s\S]*?\.media-suite-body\s*\{[\s\S]*?overflow:\s*auto/u, "Content Hub must scroll inside the full-page Media Lab shell instead of being clipped.");
assert.match(css, /\.workspace-page-first\[data-workspace-page="content"\][\s\S]*?\.media-suite-body\s*\{[\s\S]*?padding-bottom:\s*calc\(112px/u, "Content Hub needs bottom scroll padding so the taskbar/browser chrome cannot hide the last controls.");
assert.match(css, /\.media-suite-body > \.ch\s*\{[\s\S]*?min-height:\s*max-content/u, "Content Hub must be allowed to grow beyond the visible viewport inside the scroll area.");

console.log("Content Hub planner checks passed.");
