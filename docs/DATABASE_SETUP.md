# Database setup (PostgreSQL + Prisma)

PhantomForce's Prisma schema targets **PostgreSQL** (`server/prisma/schema.prisma`,
`migration_lock.toml` — both say `postgresql`, and the repo's own test scripts spin
up `postgres:16-alpine`). Use Postgres 15+ locally.

## 1. Create a local database

Any of these work; pick what's on your machine.

**Native install (Windows/macOS/Linux):**
```sql
CREATE ROLE phantomforce WITH LOGIN PASSWORD 'choose-a-password' CREATEDB;
CREATE DATABASE phantomforce_dev OWNER phantomforce;
```

**Docker:**
```bash
docker run --name phantomforce-pg -e POSTGRES_USER=phantomforce \
  -e POSTGRES_PASSWORD=choose-a-password -e POSTGRES_DB=phantomforce_dev \
  -p 127.0.0.1:5432:5432 -d postgres:16-alpine
```

## 2. Configure the environment

```bash
cp server/.env.example server/.env
# edit server/.env: set DATABASE_URL and PHANTOMFORCE_SESSION_SECRET
```

`server/.env` is gitignored. Never commit a real connection string.

## 3. Apply migrations and generate the client

From the repo root:
```bash
npx prisma migrate deploy --schema server/prisma/schema.prisma
npx prisma generate --schema server/prisma/schema.prisma
```

`npx prisma migrate status --schema server/prisma/schema.prisma` should report
"Database schema is up to date!".

## 4. Choose the auth provider

- `PHANTOMFORCE_AUTH_PROVIDER=database` — real multi-user auth (email +
  password, org memberships, invitations, org switching). In development it
  seeds clearly-marked fixtures on boot (`dev-org-*`, `dev-user-*`, `.local`
  emails, password `phantom-dev-password`); the seed never runs with
  `NODE_ENV=production` and can be disabled with
  `PHANTOMFORCE_SEED_DEV_IDENTITIES=false`.
- The existing providers (`demo`, `prisma-dev`, `owner-production`,
  `gateway-forwarded`) are unchanged and remain valid.

## 5. Start and smoke-test

```bash
npx tsx server/src/index.ts
curl -s localhost:5190/sessions | jq .auth.sessionSource   # -> "database"
curl -s -X POST localhost:5190/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"jordan@phantomforce.local","password":"phantom-dev-password"}'
```

## Dev seed identities (development data only)

| email | password | role |
|---|---|---|
| `jordan@phantomforce.local` | `phantom-dev-password` | platform super-admin; owner of PhantomForce (dev) |
| `owner@chicagoshots.local` | `phantom-dev-password` | owner of ChicagoShots (dev) |
| `employee@chicagoshots.local` | `phantom-dev-password` | member of ChicagoShots (dev) |
| `client@chicagoshots.local` | `phantom-dev-password` | restricted client of ChicagoShots (dev) |

Dev plan assignments: PhantomForce (dev) → `internal`; ChicagoShots (dev) →
`professional` (both noted `DEV SEED` in the database).

## Role model (do not collapse these)

| concept | where it lives | what it grants |
|---|---|---|
| Platform super-admin | `User.isSuperAdmin` | everything, all orgs (`canManageAccess`) |
| Org owner | `Membership.role = owner` | full control of that org only |
| Org admin | `Membership.role = admin` | manage members/invites of that org only |
| Employee/member | `Membership.role = member` | work inside that org |
| Client/restricted | `Membership.role = client` | view-oriented access, never the write bit |

Tenant isolation is enforced server-side: org routes 403 non-members, the
active org rides on the session as `clientId`, and the entitlement engine
(`server/src/access/entitlements.ts`) gates writes per org plan.

## Verification suite

A live-API test suite covers login, tenant isolation, invitations, roles,
audit, entitlements, and revocation: `server/scripts/test-database-auth.mjs`
(39 checks). Start a server with the `database` provider and run it with
`BASE=http://127.0.0.1:<port> node server/scripts/test-database-auth.mjs`.
