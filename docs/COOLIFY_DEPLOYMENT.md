# Coolify Deployment

Coolify is useful for PhantomForce as the production deployment panel: GitHub push to deploy, managed environment variables, HTTPS domains, health checks, and persistent volumes for JSON-backed app state.

Do not install Coolify inside this repository or on the Windows dev box. Install Coolify on a Linux VPS with Docker, then connect this GitHub repository as an application.

## App

- Build pack: Docker Compose
- Compose file: `docker-compose.coolify.yml`
- Public port inside the container: `5190`
- Health check path: `/health`
- Persistent volume: `phantomforce-data:/data/phantomforce`

## Domains

Point both domains at the same application:

- `admin.phantomforce.online`
- `app.phantomforce.online`

The server already switches behavior from the request host, so both domains can share one container.

## Required Secrets

Set these in Coolify, not in git:

```text
PHANTOMFORCE_SESSION_SECRET=<32+ char random secret>
PHANTOMFORCE_AUTH_PROVIDER=owner-production
PHANTOMFORCE_OWNER_EMAIL=<owner email>
PHANTOMFORCE_OWNER_LOGIN_KEY=<owner login key>
PHANTOMFORCE_PUBLIC_APP_URL=https://app.phantomforce.online
SOCIAL_OAUTH_REDIRECT_URI=https://admin.phantomforce.online/phantom-ai/ops/social-oauth/callback
```

For full multi-user production auth, switch to:

```text
PHANTOMFORCE_AUTH_PROVIDER=database
DATABASE_URL=<postgres connection string>
```

## Persistent Data

The compose file maps runtime stores into `/data/phantomforce`, including access data, Media Lab assets, customization, PhantomStore, PhantomPlay, competitor intelligence, automation state, and install acceptance logs.

That keeps deploys/rebuilds from wiping the working app state.

## Deployment Flow

1. Install Coolify on a Linux VPS following Coolify's official install flow.
2. Connect `KIDWST/phantomforce`.
3. Select Docker Compose and `docker-compose.coolify.yml`.
4. Add the required secrets.
5. Add both domains and enable HTTPS.
6. Deploy.
7. Confirm:

```text
https://admin.phantomforce.online/health
https://app.phantomforce.online/health
https://admin.phantomforce.online/app/index.html
https://app.phantomforce.online/app/index.html
```

## Why Coolify

- Useful: deployment automation, SSL, health checks, environment management, rollback-friendly builds.
- Not useful locally: Coolify itself wants a Linux Docker host and SSH-managed server environment.
- This repo now has the container files Coolify needs without binding PhantomForce to Coolify only.
