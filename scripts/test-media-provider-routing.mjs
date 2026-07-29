import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mediaLab = readFileSync(new URL("../app/js/medialab.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../server/src/phantom-ai/agent-assist-bridge.ts", import.meta.url), "utf8");

assert.match(mediaLab, /const IMAGE_MEDIA_LANE = "chatgpt_bridge"/u, "Images must use the ChatGPT Bridge lane.");
assert.match(mediaLab, /const PRIMARY_MEDIA_LANE = "higgsfield"/u, "The primary paid media lane must be Higgsfield video.");
assert.match(mediaLab, /id: IMAGE_MEDIA_LANE[\s\S]*modalities: \["image", "edit"\]/u, "ChatGPT Bridge must own image/edit modalities.");
assert.match(mediaLab, /id: PRIMARY_MEDIA_LANE[\s\S]*name: "Higgsfield Video"[\s\S]*modalities: \["video"\]/u, "Higgsfield must be video-only in Media Lab.");
assert.match(mediaLab, /image:\s*normalizeLaneId\(savedRouting\.image \|\| IMAGE_MEDIA_LANE\)[\s\S]*\? IMAGE_MEDIA_LANE/u, "Saved image routing must migrate away from Higgsfield/cinematic.");
assert.match(mediaLab, /video:\s*normalizeLaneId\(savedRouting\.video \|\| PRIMARY_MEDIA_LANE\)/u, "Saved video routing must default to Higgsfield.");
assert.match(mediaLab, /"seedance_2_0"[\s\S]*"seedance_2_0_pro"[\s\S]*"kling3_0"[\s\S]*"soul_v2"[\s\S]*"cinema"[\s\S]*"cast"[\s\S]*"location"[\s\S]*"marketing_studio_video"/u, "Higgsfield video model choices must remain selectable.");
assert.match(mediaLab, /if \(req\.provider === IMAGE_MEDIA_LANE\)[\s\S]*generateChatGptImageRequest/u, "Image generation must use the ChatGPT image request path.");
const higgsfieldBlock = mediaLab.match(/id: PRIMARY_MEDIA_LANE[\s\S]*?\n\s*\},\n\s*\{/u)?.[0] || "";
assert.ok(higgsfieldBlock, "Higgsfield provider block must exist.");
assert.doesNotMatch(higgsfieldBlock, /modalities: \[[^\]]*"image"/u, "Higgsfield must not advertise image generation.");

assert.match(server, /ChatGptImageGenerateSchema/u, "Server must validate ChatGPT image requests.");
assert.match(server, /app\.post\("\/phantom-ai\/media-lab\/chatgpt-image\/generate"/u, "Server must expose the ChatGPT image generation route.");
assert.match(server, /Do not call Higgsfield for still images/u, "Server bridge prompt must explicitly block Higgsfield for still images.");
assert.match(server, /paid_higgsfield_called:\s*false/u, "ChatGPT image route must record that Higgsfield was not charged/called.");
assert.match(bridge, /attachments: AgentAssistAttachment\[\]/u, "ChatGPT bridge result must carry image attachments.");
assert.match(bridge, /bridgeAttachments\(payload\)/u, "ChatGPT bridge must extract returned image attachments.");

console.log("Media provider routing checks passed.");
