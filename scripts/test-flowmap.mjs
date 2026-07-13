import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/js/flowmap.js", import.meta.url), "utf8");

const nodesBlock = source.match(/function flowNodes\(\) \{[\s\S]*?return \[([\s\S]*?)\];\n\}/u)?.[1] || "";
assert.ok(nodesBlock, "flowNodes must define the operations map sequence.");

const expectedOrder = ["Leads", "Quotes", "Delivery", "Sites", "Accounting", "Protection"];
const positions = expectedOrder.map((label) => nodesBlock.indexOf(`label: "${label}"`));
assert.ok(positions.every((position) => position >= 0), "The flow map must expose every requested workflow node.");
assert.deepEqual([...positions].sort((a, b) => a - b), positions, "The flow map must read Leads > Quotes > Delivery > Sites > Accounting > Protection.");

assert.match(source, /leads: \[64, 76\], quotes: \[180, 76\], delivery: \[296, 76\]/u, "Mobile row one must read Leads, Quotes, Delivery.");
assert.match(source, /site: \[296, 216\], money: \[180, 216\], protect: \[64, 216\]/u, "Mobile row two must snake Sites, Accounting, Protection.");
assert.match(source, /link\(pos\.quotes, pos\.delivery\)[\s\S]*link\(pos\.delivery, pos\.site\)[\s\S]*link\(pos\.site, pos\.money\)[\s\S]*link\(pos\.money, pos\.protect\)/u, "The animated spine must follow the requested workflow order.");

console.log("Flow map order checks passed.");
