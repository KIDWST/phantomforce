# Website Builder lifecycle

## Sources of truth

- Browser draft: the workspace-scoped `site` record in `app/js/store.js`. It owns editable title, stable section order, design fields, catalog, test cart, local recovery snapshots, and the local domain draft.
- Server build: `SiteBuild` in Prisma plus its immutable rendered file under `.phantom/site-builds/<site>/v<version>/index.html`.
- Publish decision: the `publish_site` agent run. It is the approval and audit record for the exact build ID.
- Live truth: the current `SiteDeployment` and a successful read of `/public/sites/<siteId>`. A requested or approved run is not live.
- Domain truth: `SiteDomain`, scoped to its organization. Typing a domain does not connect it; the DNS adapter must verify the ownership TXT record and report resolver/SSL state.
- Ephemeral UI: selected region, preview device, live/draft preview mode, open comparison, and unapplied AI proposal.

Legacy Termina starter records are normalized once at the read boundary to the PhantomForce public-site template. The original record remains available as the first recovery snapshot.

## Owner workflow

1. Select a stable page region or section.
2. Edit its structured field directly, or ask Phantom for a scoped proposal.
3. Review the proposal’s before/after diff. Applying it creates a recovery point; discarding it changes nothing.
4. Compare the current draft with any saved recovery point. Restore remains explicit.
5. Review launch readiness.
6. Build and request publish approval. The validated build ID and run ID remain visible.
7. Approve through the existing organization approval workflow.
8. Show Live only after the server run succeeds and the published file is verified.
9. Connect a custom domain only on an entitled plan, add the supplied TXT record, and run DNS verification.
10. Roll back through the manager-only server route when a prior verified deployment exists.

## Failure and recovery

- A failed proposal preserves the current draft.
- A rejected, expired, cancelled, or failed publish never changes the live label.
- A DNS failure retains its instructions and can be retried.
- Rollback failure leaves the current deployment unchanged.
- Local-only sessions request approval honestly but never claim deployment.
- Refresh reloads the saved draft and recovery history; server-backed sessions hydrate deployment and domain evidence.

## Rollback

- Draft rollback: History → Compare → Restore.
- Live rollback: Release evidence → Rollback to previous live version.
- Code rollback target for this slice: the parent of the Phase 3 release commit.
