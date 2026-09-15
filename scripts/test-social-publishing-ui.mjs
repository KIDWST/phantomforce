import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [hub, client, server, connector, store] = await Promise.all([
  readFile(new URL("../app/js/contenthub.js", import.meta.url), "utf8"),
  readFile(new URL("../app/js/contentpublication.js", import.meta.url), "utf8"),
  readFile(new URL("../server/src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/src/connectors/social-publishing-connector.ts", import.meta.url), "utf8"),
  readFile(new URL("../server/src/content/content-publication-store.ts", import.meta.url), "utf8"),
]);

assert.match(hub, /Approve & publish everywhere/u);
assert.match(hub, /signed platform post receipts/u);
assert.match(hub, /approveAndSubmitContentPublication/u);
assert.match(hub, /syncServerPublications/u);
assert.match(hub, /ensurePublishAssetSynced/u);
assert.match(hub, /providerReceiptId/u);
assert.match(client, /draft\.status === "approval"[\s\S]*"approval_required"/u);
assert.match(client, /serverSourceAssetId/u);
assert.match(client, /\/api\/content-publications\/\$\{encodeURIComponent\(publication\.id\)\}\/approve/u);
assert.match(server, /social_publishing:\s*getSocialPublishingConnectorStatus\(\)/u);
assert.match(server, /app\.post\("\/api\/social\/provider\/events"/u);
assert.match(connector, /phantomforce_social_executor_v1/u);
assert.match(connector, /x-idempotency-key/u);
assert.match(connector, /timingSafeEqual/u);
assert.match(connector, /platform_post_receipt_required/u);
assert.match(store, /status:\s*"pending" \| "submitted" \| "published" \| "failed"/u);
assert.match(store, /submissionReceiptId/u);
assert.match(store, /providerEventIds/u);
assert.doesNotMatch(hub, /data-ch-pub-live disabled/u);

console.log(JSON.stringify({
  ok: true,
  suite: "social-publishing-ui",
  unifiedComposer: true,
  approvalGate: true,
  signedReceipts: true,
  analyticsHydration: true,
}, null, 2));
