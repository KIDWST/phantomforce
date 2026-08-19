import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomstore-"));
process.env.PHANTOMFORCE_PHANTOMSTORE_PATH = join(root, "phantomstore.json");
process.env.PHANTOMFORCE_PHANTOMSTORE_AI_PRODUCTS_PATH = join(root, "phantomstore-ai-products.json");
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";

const owner: AccessSession = { id: "owner", userId: "owner-user", label: "Owner Studio", role: "admin", canManageAccess: true, orgId: "org-owner", orgRole: "owner", isSuperAdmin: true };
const devA: AccessSession = { id: "dev-a", userId: "dev-a", label: "Developer A", role: "client", canManageAccess: false, orgId: "org-a", orgRole: "member" };
const devB: AccessSession = { id: "dev-b", userId: "dev-b", label: "Developer B", role: "client", canManageAccess: false, orgId: "org-b", orgRole: "member" };

try {
  const store = await import("../src/phantom-ai/phantomstore.js");
  const stripeProducts = await import("../src/commerce/stripe-product-checkout.js");

  const initial = await store.getPhantomStoreSnapshot(devA);
  assert(initial.catalog.length === 0, "A fresh store should ship no seeded tools.");
  assert(initial.products.some((product: { name?: string }) => product.name === "Termina"), "PhantomStore should ship PhantomForce products, including Termina.");
  assert(initial.products.some((product: { name?: string }) => product.name === "BeatForge"), "PhantomStore should list BeatForge instead of the internal PhantomForce OS workspace.");
  const integratedProducts = initial.products.filter((product: { workspaceProductId?: string }) => Boolean(product.workspaceProductId));
  assert(integratedProducts.length === 10, "PhantomStore should serve exactly ten integrated AI workspace listings.");
  assert(integratedProducts.every((product: { buyLabel?: string; priceLabel?: string; imageUrl?: string; useCases?: unknown[] }) => product.buyLabel === "Buy & unlock" && /one-time/u.test(product.priceLabel || "") && /ai-workspaces/u.test(product.imageUrl || "") && (product.useCases?.length || 0) >= 3), "Every AI product should be paid and ship custom art plus real use cases.");
  assert(initial.library.length === 0, "AI workspaces must not be silently unlocked for a new account.");
  assert(initial.internalAdminUnrestricted === false, "Customer accounts must not inherit internal admin product access.");
  const ownerInitial = await store.getPhantomStoreSnapshot(owner);
  const ownerAiLibrary = ownerInitial.library.filter((entry: { product?: { workspaceProductId?: string }; entitlement?: { status?: string } }) => entry.product?.workspaceProductId && entry.entitlement?.status === "active");
  assert(ownerInitial.internalAdminUnrestricted === true && ownerAiLibrary.length === 10, "The platform admin must receive every internal AI workspace without a purchase.");
  const ownerAccess = await store.getPhantomStoreWorkspaceProductAccessMap(owner);
  assert(Object.values(ownerAccess).every((entry) => entry.active && entry.accessSource === "platform_admin"), "Admin AI workspace access must resolve from platform authority, not checkout state.");
  const customerAccess = await store.getPhantomStoreWorkspaceProductAccessMap(devA);
  assert(Object.values(customerAccess).every((entry) => !entry.active && entry.accessSource === "none"), "A customer without purchases must remain locked out of paid AI workspaces.");
  const firstInternalProduct = integratedProducts[0] as { id: string; compatiblePlatforms: string[] };
  const adminInstall = await store.mutatePhantomStoreInstallation(owner, firstInternalProduct.id, { action: "install", platform: firstInternalProduct.compatiblePlatforms[0] });
  assert(adminInstall.installation.status === "installed", "A platform admin must be able to install an internal product without minting a purchase entitlement.");
  const postAdminAccessStore = JSON.parse(await readFile(process.env.PHANTOMFORCE_PHANTOMSTORE_PATH, "utf8")) as { entitlements: Array<{ actorId: string }> };
  assert(!postAdminAccessStore.entitlements.some((entry) => entry.actorId === "owner-user"), "Internal admin access must never be persisted as a fake purchase entitlement.");
  const unpaid = await stripeProducts.processVerifiedStripeProductCheckout({ type: "checkout.session.completed", data: { object: { id: "cs_unpaid_proof", payment_status: "unpaid", metadata: { phantomforce_purchase_type: "phantomstore_product", phantomforce_product_id: "product-ai-proof", phantomforce_tenant_id: "unpaid-account", phantomforce_actor_id: "unpaid-user" } } } } as any);
  assert(unpaid?.outcome === "payment_pending", "An unpaid Checkout session must never create ownership.");
  const suiteBuyer: AccessSession = { id: "suite-user", userId: "suite-user", label: "Suite buyer", role: "client", canManageAccess: false, orgId: "suite-account", orgRole: "member" };
  for (const product of integratedProducts as Array<{ id: string }>) {
    const result = await stripeProducts.processVerifiedStripeProductCheckout({ type: "checkout.session.completed", data: { object: { id: `cs_paid_${product.id}`, payment_status: "paid", metadata: { phantomforce_purchase_type: "phantomstore_product", phantomforce_product_id: product.id, phantomforce_tenant_id: "suite-account", phantomforce_actor_id: "suite-user" } } } } as any);
    assert(result?.outcome === "entitlement_granted", `${product.id} should unlock from its own verified paid Checkout receipt.`);
  }
  const duplicateSuitePurchase = await stripeProducts.processVerifiedStripeProductCheckout({ type: "checkout.session.completed", data: { object: { id: `cs_paid_${integratedProducts[0].id}`, payment_status: "paid", metadata: { phantomforce_purchase_type: "phantomstore_product", phantomforce_product_id: integratedProducts[0].id, phantomforce_tenant_id: "suite-account", phantomforce_actor_id: "suite-user" } } } } as any);
  assert(duplicateSuitePurchase?.duplicate === true, "Replaying a customer paid Checkout event must remain idempotent.");
  const suiteAccess = await store.getPhantomStoreWorkspaceProductAccessMap(suiteBuyer);
  assert(Object.values(suiteAccess).filter((entry) => entry.active).length === 10, "All ten paid products must map to durable account access.");
  assert(!initial.products.some((product: { id?: string }) => product.id === "product-phantomforce-os"), "PhantomForce OS must not be sold inside the store users are already using.");
  assert(initial.sellers.some((seller: { name?: string }) => seller.name === "PhantomForce"), "PhantomStore should include a PhantomForce seller profile.");
  assert(initial.products.every((product: { reviews?: unknown[] }) => Array.isArray(product.reviews)), "Product listings should carry product reviews.");
  assert(initial.sellers.every((seller: { reviews?: unknown[] }) => Array.isArray(seller.reviews)), "Seller listings should carry seller reviews.");
  assert(initial.canModerate === false, "A regular developer must not receive moderation access.");
  assert(initial.submissions.length === 0, "A developer with no submissions should see an empty list.");

  let incompleteRejected = false;
  try { await store.submitPhantomStoreTool(devA, { name: "Bad", submit: true }); } catch { incompleteRejected = true; }
  assert(incompleteRejected, "Incomplete tool submissions must be rejected when submit is true.");

  const draft = await store.submitPhantomStoreTool(devA, { name: "Draft Only", summary: "Not ready yet." });
  assert(draft.tool.status === "draft", "Saving without submit:true should store a draft even though required fields are still missing.");
  assert(draft.issues.length > 0, "The draft should still report which fields are outstanding, for the UI to show before submit.");

  const generated = store.generatePhantomStoreSubmissionDrafts({
    sourceText: [
      "Agent Brief Builder - Turns messy notes into clean operator briefs - https://github.com/example/agent-brief-builder - npm install -g agent-brief-builder",
      "Caption Forge, Generates short-form caption options for sports clips, https://github.com/example/caption-forge",
      "Mystery Tool - Needs a source before public review",
    ].join("\n"),
    defaultCategory: "AI Tool",
  });
  assert(generated.drafts.length === 3, "PhantomStore AI intake should draft multiple tools from pasted lines.");
  assert(generated.providerCalled === false && generated.externalFetchPerformed === false, "Draft intake must stay local and deterministic by default.");
  assert(generated.databaseWritten === false, "Draft generation alone must not write the store.");
  assert(generated.drafts[0].installMethod === "npm", "Draft intake should infer npm install commands.");
  assert(generated.drafts[1].repoUrl.includes("github.com/example/caption-forge"), "Draft intake should carry through source URLs.");
  assert(generated.drafts[2].readiness === "missing_source", "Draft intake should flag missing source URLs instead of pretending the item is ready.");

  const bulkDrafts = await store.saveGeneratedPhantomStoreDrafts(devA, { drafts: generated.drafts.slice(0, 2) });
  assert(bulkDrafts.tools.length === 2, "Generated drafts should be saveable in bulk as drafts.");
  assert(bulkDrafts.tools.every((tool) => tool.status === "draft"), "Bulk generated drafts must never auto-submit for public review.");

  const created = await store.submitPhantomStoreTool(devA, {
    name: "Repo Sync CLI",
    summary: "Keep two git repos in lockstep from a single command.",
    description: "A small CLI that mirrors commits between two remotes on a schedule, built for the PhantomForce agent worktree workflow.",
    category: "CLI",
    tags: ["git", "sync", "cli"],
    repoUrl: "https://github.com/example/repo-sync-cli",
    installMethod: "npm",
    installCommand: "npm install -g repo-sync-cli",
    version: "1.0.0",
    license: "MIT",
    submit: true,
  });
  assert(created.tool.status === "submitted", "A complete submission should enter the moderation queue.");
  assert(created.tool.developerId === "dev-a", "The submission should be attributed to the actor, not a client-supplied id.");

  const isolated = await store.getPhantomStoreSnapshot(devB);
  assert(isolated.submissions.length === 0, "Submissions must stay isolated between developers.");
  assert(isolated.catalog.length === 0, "Unapproved tools must not appear in anyone's public catalog.");

  let playerModerationBlocked = false;
  try { await store.moderatePhantomStoreTool(devA, created.tool.id, { decision: "approved" }); } catch { playerModerationBlocked = true; }
  assert(playerModerationBlocked, "Non-admin developers must not moderate tools, including their own.");

  let badRepoRejected = false;
  let badRepoMessage = "";
  try {
    await store.submitPhantomStoreTool(devA, {
      name: "Bad Repo Link", summary: "Uses a non-http scheme.", description: "Deliberately invalid repo URL to prove scheme validation.",
      repoUrl: "javascript:alert(1)", installMethod: "manual", submit: true,
    });
  } catch (error) {
    badRepoRejected = true;
    badRepoMessage = error instanceof Error ? error.message : "";
  }
  assert(badRepoRejected, "A non-http(s) repo URL must be sanitized away and fail submission, not get stored.");
  assert(badRepoMessage.toLowerCase().includes("repo"), "The validation error should mention the missing/invalid repo URL.");

  await store.moderatePhantomStoreTool(owner, created.tool.id, { decision: "approved", featured: true, note: "Looks solid." });
  const approved = await store.getPhantomStoreSnapshot(devB);
  assert(approved.catalog.some((tool) => tool.name === "Repo Sync CLI"), "An approved tool should enter the public catalog for every tenant.");
  assert(!("moderationNote" in approved.catalog[0]), "The public catalog must never leak internal moderation notes.");

  const clicked = await store.recordPhantomStoreInstallClick(devB, created.tool.id);
  assert(clicked?.installClicks === 1, "Install clicks on an approved tool should increment.");
  const clickedAgain = await store.recordPhantomStoreInstallClick(devB, created.tool.id);
  assert(clickedAgain?.installClicks === 2, "Install clicks should accumulate across visitors.");

  const buyClick = await store.recordPhantomStoreProductBuyClick(devB, "product-termina");
  assert(buyClick?.buyClicks === 1, "Product buy intent clicks should be tracked.");
  assert(buyClick?.checkout?.url.includes("termina"), "Termina buy intent should point at the Termina product page.");
  const beatForgeClick = await store.recordPhantomStoreProductBuyClick(devB, "product-beatforge");
  assert(beatForgeClick?.checkout?.url.includes("beatforge"), "BeatForge buy intent should point at the BeatForge product page.");

  let developerGrantBlocked = false;
  try {
    await store.grantPhantomStoreProductEntitlement(devA, "product-termina", {
      purchaseReference: "purchase-developer-forged",
    });
  } catch {
    developerGrantBlocked = true;
  }
  assert(developerGrantBlocked, "A customer must not be able to forge their own product entitlement.");

  const entitlementGrant = await store.grantPhantomStoreProductEntitlement(owner, "product-termina", {
    tenantId: "org-a",
    actorId: "dev-a",
    purchaseReference: "purchase-termina-org-a-dev-a",
  });
  assert(entitlementGrant.entitlement.status === "active" && entitlementGrant.idempotent === false, "A verified purchase reference should grant an active entitlement.");
  const duplicateGrant = await store.grantPhantomStoreProductEntitlement(owner, "product-termina", {
    tenantId: "org-a",
    actorId: "dev-a",
    purchaseReference: "purchase-termina-org-a-dev-a",
  });
  assert(duplicateGrant.idempotent === true && duplicateGrant.entitlement.id === entitlementGrant.entitlement.id, "Repeating a purchase reference must be idempotent.");

  let incompatibleInstallBlocked = false;
  try {
    await store.mutatePhantomStoreInstallation(devA, "product-termina", { action: "install", platform: "linux-x64" });
  } catch {
    incompatibleInstallBlocked = true;
  }
  assert(incompatibleInstallBlocked, "Install state must not advance on an incompatible platform.");
  const installed = await store.mutatePhantomStoreInstallation(devA, "product-termina", { action: "install", platform: "windows-x64" });
  assert(installed.installation.status === "installed" && installed.installation.installedVersion === "0.2.0", "A compatible entitled product should enter installed state at the catalog version.");
  const updateNoop = await store.mutatePhantomStoreInstallation(devA, "product-termina", { action: "update", platform: "windows-x64" });
  assert(updateNoop.changed === false, "Updating an already-current installation must be idempotent.");
  const uninstalled = await store.mutatePhantomStoreInstallation(devA, "product-termina", { action: "uninstall", platform: "windows-x64" });
  assert(uninstalled.installation.status === "uninstalled" && uninstalled.userDataPreserved === true, "Uninstall must preserve user data by default.");
  const restoredInstall = await store.mutatePhantomStoreInstallation(devA, "product-termina", { action: "restore", platform: "windows-x64" });
  assert(restoredInstall.installation.status === "installed" && restoredInstall.userDataPreserved === true, "An entitled user should be able to restore an uninstalled product without losing data.");
  const revoked = await store.revokePhantomStoreProductEntitlement(owner, "product-termina", { tenantId: "org-a", actorId: "dev-a" });
  assert(revoked?.entitlement.status === "revoked" && revoked.userDataPreserved === true, "Plan/access loss must revoke access without deleting installed user data.");
  const restoredEntitlement = await store.grantPhantomStoreProductEntitlement(owner, "product-termina", {
    tenantId: "org-a",
    actorId: "dev-a",
    purchaseReference: "purchase-termina-org-a-dev-a",
  });
  assert(restoredEntitlement.restored === true && restoredEntitlement.entitlement.status === "active", "Replaying the verified purchase should restore the same revoked entitlement.");
  const library = await store.getPhantomStoreSnapshot(devA);
  assert(library.library.length === 1 && library.library[0].installation.userDataStatus === "preserved", "The customer's library must expose only their tenant-scoped entitlement and preserved install state.");
  const otherLibrary = await store.getPhantomStoreSnapshot(devB);
  assert(otherLibrary.library.length === 0, "Product entitlements and installations must remain tenant and actor isolated.");

  const draftClick = await store.recordPhantomStoreInstallClick(devB, draft.tool.id);
  assert(draftClick === null, "Install clicks must not count against tools that were never approved.");

  await store.moderatePhantomStoreTool(owner, created.tool.id, { decision: "disabled", note: "Pulled for test." });
  const disabled = await store.getPhantomStoreSnapshot(devB);
  assert(!disabled.catalog.some((tool) => tool.name === "Repo Sync CLI"), "A disabled tool must disappear from the catalog immediately.");

  let staleUpdateBlocked = false;
  try { await store.updatePhantomStoreTool(devA, created.tool.id, { summary: "Sneaky re-edit." }); } catch { staleUpdateBlocked = true; }
  assert(staleUpdateBlocked, "A developer must not silently re-edit a tool that has already left draft/submitted state without review.");

  const crossEdit = await store.updatePhantomStoreTool(devB, draft.tool.id, { summary: "Hijacked." });
  assert(crossEdit === null, "A developer must not edit another developer's submission.");

  const revised = await store.updatePhantomStoreTool(devA, draft.tool.id, {
    name: "Draft Only",
    summary: "Now finished and ready.",
    description: "The draft was completed through the edit flow and resubmitted for review.",
    repoUrl: "https://github.com/example/draft-only",
    installMethod: "manual",
    submit: true,
  });
  assert(revised?.tool.status === "submitted", "A developer should be able to finish a draft through the edit flow and resubmit it.");
  assert(revised?.tool.summary === "Now finished and ready.", "The edit flow should persist revised fields.");

  const status = await store.getPhantomStoreStatus();
  assert(status.tools === 4 && status.approvedTools === 0, "Status should reflect total tools written and current approved count (rejected submissions never get stored).");
  assert(status.products >= 3 && status.sellers >= 1, "Status should include seeded product and seller counts.");

  const persisted = JSON.parse(await readFile(process.env.PHANTOMFORCE_PHANTOMSTORE_PATH, "utf8")) as { tools: unknown[] };
  assert(persisted.tools.length === 4, "Tool submissions should be durable across process restarts.");

  const { app } = await import("../src/index.js");
  const unauthenticated = await app.inject({ method: "GET", url: "/api/phantomstore" });
  assert(unauthenticated.statusCode === 401, "The catalog API must require a signed-in session.");
  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert(response.statusCode === 200, `${sessionId} should obtain a local test token.`);
    return (response.json() as { token: string }).token;
  };
  const ownerToken = await login("admin-jordan");
  const devToken = await login("client-sports-demo");
  const ownerView = await app.inject({ method: "GET", url: "/api/phantomstore", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(ownerView.statusCode === 200 && ownerView.json().canModerate === true && ownerView.json().internalAdminUnrestricted === true, "Platform admin sessions should receive moderation and unrestricted internal product access via the route.");
  const devView = await app.inject({ method: "GET", url: "/api/phantomstore", headers: { Authorization: `Bearer ${devToken}` } });
  assert(devView.statusCode === 200 && devView.json().canModerate === false && devView.json().internalAdminUnrestricted === false, "A free-plan client session should still be able to view the catalog without internal product authority.");
  const aiWorkspaceView = await app.inject({ method: "GET", url: "/api/phantomstore/ai-products", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(aiWorkspaceView.statusCode === 200 && aiWorkspaceView.json().products.length === 10, "The authenticated admin product service should expose every internal AI product.");
  assert(aiWorkspaceView.json().deployment === "served_phantomstore_admin_unrestricted_release" && aiWorkspaceView.json().internalAdminUnrestricted === true, "The product service should report its unrestricted internal admin state honestly.");
  assert(aiWorkspaceView.json().products.every((product: { store?: { state?: string; commerceActive?: boolean } }) => product.store?.state === "platform_admin_product" && product.store?.commerceActive === false), "Internal admin products must open as included products without commerce controls.");
  const oracle = aiWorkspaceView.json().products.find((product: { id: string }) => product.id === "phantom-oracle");
  assert(Boolean(oracle?.sample), "PHANTOM ORACLE should ship a usable in-store demo fixture.");
  const consentRoute = await app.inject({
    method: "POST",
    url: "/api/phantomstore/ai-products/phantom-oracle/consent",
    headers: { Authorization: `Bearer ${ownerToken}`, "Idempotency-Key": "oracle-route-review" },
    payload: { status: "granted", purpose: "Test the integrated store decision workflow." },
  });
  assert(consentRoute.statusCode === 200 && consentRoute.json().consent.status === "granted", "The served product route should persist explicit purpose consent.");
  const artifactRoute = await app.inject({
    method: "POST",
    url: "/api/phantomstore/ai-products/phantom-oracle/artifacts",
    headers: { Authorization: `Bearer ${ownerToken}`, "Idempotency-Key": "oracle-route-artifact" },
    payload: { fields: oracle.sample, evidenceNote: "Declared route-test fixture.", evidenceLabel: "PhantomStore integration test" },
  });
  assert(artifactRoute.statusCode === 200 && artifactRoute.json().artifact.productId === "phantom-oracle", "The served product route should persist a versioned Oracle artifact.");
  const integratedArtifactId = artifactRoute.json().artifact.id as string;
  const analysisRoute = await app.inject({
    method: "POST",
    url: `/api/phantomstore/ai-products/artifacts/${integratedArtifactId}/analyses`,
    headers: { Authorization: `Bearer ${ownerToken}`, "Idempotency-Key": "oracle-route-analysis" },
  });
  assert(analysisRoute.statusCode === 200 && analysisRoute.json().analysis.status === "pending_review", "The served product route should run the Oracle core loop and require review.");
  assert(analysisRoute.json().analysis.output.coreLoop.productId === "phantom-oracle" && analysisRoute.json().analysis.output.coreLoop.modules.length > 0, "The integrated analysis should expose its complete product-specific core loop.");
  const integratedAnalysisId = analysisRoute.json().analysis.id as string;
  const reviewRoute = await app.inject({
    method: "POST",
    url: `/api/phantomstore/ai-products/analyses/${integratedAnalysisId}/review`,
    headers: { Authorization: `Bearer ${ownerToken}`, "Idempotency-Key": "oracle-route-review" },
    payload: { decision: "accepted" },
  });
  assert(reviewRoute.statusCode === 200 && reviewRoute.json().analysis?.finalDisposition === "accepted", `The served product route should persist a human review disposition: ${reviewRoute.body}`);
  const clientAiView = await app.inject({ method: "GET", url: "/api/phantomstore/ai-products", headers: { Authorization: `Bearer ${devToken}` } });
  assert(clientAiView.statusCode === 200 && clientAiView.json().products.length === 0 && clientAiView.json().artifacts.length === 0, "Unpurchased products and integrated data must remain locked and isolated between accounts.");
  const devSubmitBlocked = await app.inject({
    method: "POST", url: "/api/phantomstore/tools", headers: { Authorization: `Bearer ${devToken}` },
    payload: { name: "Route Tool", summary: "Submitted through the HTTP route.", description: "Proves the Fastify route wiring saves a tool end to end.", repoUrl: "https://example.test/route-tool", installMethod: "manual", submit: true },
  });
  assert(devSubmitBlocked.statusCode === 403, "The platform's fail-closed write gate should block a free-plan session from submitting through the route, same as any other mutating route.");
  const ownerSubmit = await app.inject({
    method: "POST", url: "/api/phantomstore/tools", headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { name: "Route Tool", summary: "Submitted through the HTTP route.", description: "Proves the Fastify route wiring saves a tool end to end.", repoUrl: "https://example.test/route-tool", installMethod: "manual", submit: true },
  });
  assert(ownerSubmit.statusCode === 200 && ownerSubmit.json().tool.status === "submitted", "The submission route should accept a complete tool and enter review for a session with write access.");
  const aiDraftRoute = await app.inject({
    method: "POST", url: "/api/phantomstore/tools/ai-draft", headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { sourceText: "Route Draft Agent - Drafts listings from notes - https://github.com/example/route-draft-agent", defaultCategory: "Agent" },
  });
  assert(aiDraftRoute.statusCode === 200 && aiDraftRoute.json().drafts.length === 1, "The AI draft route should return generated drafts.");
  assert(aiDraftRoute.json().providerCalled === false, "The AI draft route should not pretend it called an external AI provider.");
  const bulkDraftRoute = await app.inject({
    method: "POST", url: "/api/phantomstore/tools/bulk-drafts", headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { drafts: aiDraftRoute.json().drafts },
  });
  assert(bulkDraftRoute.statusCode === 200 && bulkDraftRoute.json().tools[0].status === "draft", "The bulk draft route should save generated listings as drafts only.");
  const routeToolId = ownerSubmit.json().tool.id as string;
  const ownerModeration = await app.inject({ method: "POST", url: `/api/phantomstore/tools/${routeToolId}/moderate`, headers: { Authorization: `Bearer ${ownerToken}` }, payload: { decision: "approved" } });
  assert(ownerModeration.statusCode === 200 && ownerModeration.json().tool.status === "approved", "The moderation route should approve a tool for an admin session.");
  const installRoute = await app.inject({ method: "POST", url: `/api/phantomstore/tools/${routeToolId}/install`, headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(installRoute.statusCode === 200 && installRoute.json().installClicks === 1, "The install-click route should record a click for an approved tool.");
  const routeEdit = await app.inject({ method: "POST", url: `/api/phantomstore/tools/${routeToolId}`, headers: { Authorization: `Bearer ${ownerToken}` }, payload: { summary: "Edited through the update route.", submit: true } });
  assert(routeEdit.statusCode === 200 && routeEdit.json().tool.summary === "Edited through the update route.", "The update route should save edits for an authorized session.");
  const routeEditMissing = await app.inject({ method: "POST", url: "/api/phantomstore/tools/tool-does-not-exist", headers: { Authorization: `Bearer ${ownerToken}` }, payload: { summary: "Nope." } });
  assert(routeEditMissing.statusCode === 404, "The update route should 404 for unknown tools.");
  const productBuyRoute = await app.inject({ method: "POST", url: "/api/phantomstore/products/product-termina/buy", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(productBuyRoute.statusCode === 200 && productBuyRoute.json().checkout.url.includes("termina"), "The product buy route should prepare the Termina checkout target.");
  const routeGrant = await app.inject({
    method: "POST",
    url: "/api/phantomstore/products/product-termina/entitlements",
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { purchaseReference: "owner-route-termina-purchase" },
  });
  assert(routeGrant.statusCode === 200 && routeGrant.json().entitlement.status === "active", "The admin entitlement route should grant verified owner access.");
  const routeInstall = await app.inject({
    method: "POST",
    url: "/api/phantomstore/products/product-termina/installation",
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { action: "install", platform: "windows-x64" },
  });
  assert(routeInstall.statusCode === 200 && routeInstall.json().installation.status === "installed", "The installation route should record a compatible entitled installation.");
  const routeUninstall = await app.inject({
    method: "POST",
    url: "/api/phantomstore/products/product-termina/installation",
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { action: "uninstall", platform: "windows-x64" },
  });
  assert(routeUninstall.statusCode === 200 && routeUninstall.json().userDataPreserved === true, "The uninstall route should preserve user data by default.");
  const beatForgePreview = await app.inject({
    method: "POST",
    url: "/api/beatforge/preview",
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: {
      beatName: "Store Route Beat",
      beatPath: "C:\\Users\\jorda\\Music\\owned\\store-route-beat.wav",
      bpm: 143,
      daw: "reaper",
      kitName: "Route Kit",
      kitSounds: [{ name: "Route Kick", role: "kick" }, { name: "Route Snare", role: "snare" }],
    },
  });
  assert(beatForgePreview.statusCode === 200 && beatForgePreview.json().preview.product === "BeatForge", "BeatForge preview route should return a deterministic product plan.");
  assert(beatForgePreview.json().files_written === false && beatForgePreview.json().daw_mutated === false && beatForgePreview.json().audio_uploaded === false, "BeatForge preview must not write files, mutate the DAW, or upload audio.");
  await app.close();

  console.log(JSON.stringify({ ok: true, tenantIsolation: true, validationEnforced: true, moderationGated: true, catalogFiltered: true, installClicksTracked: true, entitlementIdempotency: true, paidWebhookFulfillment: true, unpurchasedApiLocked: true, compatibilityChecks: true, uninstallPreservesData: true, routeAuth: true, integratedAiProducts: 10, integratedCoreLoop: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
