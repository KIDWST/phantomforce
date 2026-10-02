# Business workspace boundaries

This change adds an authenticated business selector to the existing organization and tenant architecture. It does not replace authentication or merge existing records.

## HTTP contract

- Send the ordinary bearer session plus `x-phantomforce-business: <tenantId>`.
- `GET /api/business-workspaces` returns authorized `workspaces`, `activeTenantId` and a safe `defaultTenantId`. Each entry has `tenantId`, `businessId`, `name`, `canManage`, `role`, `contactEmail`, and `legacy`.
- A database member needs membership in the exact tenant. A display name never authorizes access. Platform super-admin and legacy owner identities retain their explicit owner authority.
- Header, query/body tenant fields, and organization route parameters must agree. The server projects the validated selection onto the request's organization identity and resolves the selected membership role and entitlement. Authentication endpoints remain independent so organization switching can complete.
- `GET /api/business-workspaces/records` returns `{ok,tenant_id,canManage,records}`. `POST` returns `{ok,tenant_id,record}`; `PATCH /api/business-workspaces/records/:id` updates the same-business record. Include `expectedVersion` to reject stale edits. Only owners/admins can write.
- These new operational records use the project's durable document-store pattern, with per-business hashed filenames, atomic replacement, process-local write serialization, schema/scope validation, and no silent recovery from corrupt data. They are not a replacement for the existing PostgreSQL CRM, Asset Cloud, or connection tables.

## Profiles and future businesses

Default tenant/profile mappings:

| Tenant | Profile | Business |
| --- | --- | --- |
| `phantomforce` | `phantomforce` | PhantomForce |
| `client-chicagoshots` | `chicagoshots` | ChicagoShots |
| `occasionally-odd` | `occasionallyodd` | Occasionally Odd |

`PHANTOMFORCE_BUSINESS_WORKSPACES` can supply explicit JSON entries with `id`, `tenantId`, `name`, `assistantContext`, and optional `contactEmail`. Use a known organization ID, never a name match. This supports existing UUID organization IDs without moving records. Membership and entitlements remain authoritative. Custom workflow policies can be added to the server registry alongside new UI profiles.

The existing platform organization `phantomforce-internal` retains its exact data scope and PhantomForce profile, including its platform integrations. It is not renamed or merged into `phantomforce`. Database users' switchers use their actual memberships. Production bootstrap can select only the intended new memberships with repeated `--tenant-id` arguments; unknown tenant selections fail before contacting the database.

## Conservative migration and compatibility

No production database, environment, credentials, or existing storage was changed while implementing this feature.

`npm run business-workspaces:migration-plan --workspace @phantomforce/server` is an offline dry-run. It does not load dotenv or contact a database.

After explicit deployment approval and verification of the target database, an operator may run the migration script with `--apply --owner-user-id <verified-existing-super-admin-id>`. It creates missing organization rows and missing owner memberships inside one transaction. It does not change existing roles, names, account selection, plans, customers, assets, or credentials. Existing organization mappings should be configured before applying.

`phantomforce-owner` remains a separate legacy private namespace. Owners see **PhantomForce — legacy private records** in the catalog, with the PhantomForce profile and `legacy:true`. Selecting it reads the original private memory, content assets, social connections, and credential namespace. Nothing automatically copies those records into `phantomforce` or another company. Unknown old namespaces remain untouched for explicit inventory and review.

## Integrations and AI

Existing PostgreSQL organization routes retain their membership and query filters. The business guard rejects a different organization path even for an owner viewing a selected company. Memory, content assets, financial receipt storage, workspace context and assistant retrieval use the validated business.

Social account tokens, account IDs, handles, OAuth state and provider connections use business namespaces. Existing global account-token environment values are usable only in the legacy PhantomForce namespace; new businesses need their own authorized accounts. Shared OAuth application client credentials remain server infrastructure, and are not exposed as company account connections. Meta authorization requires one selectable Page or an exact configured per-business Page ID when selection is ambiguous.

Global AI environment credentials belong to PhantomForce. Other businesses use their own encrypted provider vault. A missing tenant key cannot fall back to the owner's environment key at the transport layer.

The assistant receives server-owned business context. Shared machine Codex, Claude, ChatGPT bridge, Termina and administrative integration routes are not available from another company's workspace. Scoped Hermes requires a dedicated runtime URL and key, configured as `PHANTOMFORCE_HERMES_<UPPERCASE_TENANT_WITH_UNDERSCORES>_URL` and `..._KEY`. That runtime must have its own filesystem/tool allowlists and credential store. The server refuses to substitute the owner's runtime. Existing PhantomForce integrations remain available in the PhantomForce or legacy private context.

The operator WebSocket carries the bearer token and mandatory `business_id` in its initial authentication frame, never in its URL. The server authorizes that business before subscribing or sending events, binds it to the operator workspace, and revalidates identity before updates, cancellation and heartbeats. The browser closes a stream if its selected business changes. The streaming regression covers missing scope, cross-business selection and revoked tokens as well as cursor recovery and cancellation.

Orders/products cannot advance past production without original-work confirmation or an authorized license reference. Tracker edits cannot invent approval, publication or delivery receipts. Freebie campaigns cannot be launched through a tracker status.

## Verification and limits

`npm run test:business-workspaces --workspace @phantomforce/server` exercises authenticated HTTP switching and rejection, three-business records, membership/role checks, corrupt data refusal, concurrent writes, stale-version conflicts, mapped profile policies, Windows-safe filenames, AI credentials and social/asset/Studio boundaries. All fixtures use isolated temporary paths; no live provider is called.

The legacy scheduled automation engine, machine asset library and shared machine execution tools have platform-wide storage. They remain isolated to the PhantomForce owner surface instead of being presented as connected to new businesses. Company-specific work uses scoped workspace records, approvals, CRM and provider connections.

The document-store serialization assumes the project's existing single-writer server process. A future multi-process deployment should move this new store to a transactional organization-keyed database table before enabling multiple writers. PostgreSQL integration tests and any actual bootstrap/migration require an explicitly selected non-production database; no live database was used for this change.
