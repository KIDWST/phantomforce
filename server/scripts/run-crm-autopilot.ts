import "../src/load-env.js";

import { runAutomationJobNow } from "../src/phantom-ai/automation-engine.js";

const result = await runAutomationJobNow("crm-outreach-autopilot");
console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exitCode = 1;
