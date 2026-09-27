# Tamam Announcement Builder

Docker-ready standalone edition of the bilingual announcement builder. Includes both templates, rich-text editing, image uploads, HTML/PNG/PDF exports, department login, roles and permissions, saved drafts, vendor/service management, and the sent-announcement dashboard.

## Run with Docker

Requires Docker Engine/Desktop with Compose v2.

```sh
cp .env.example .env
openssl rand -hex 32
```

Paste the generated value into `SETUP_TOKEN` in `.env`, then:

```sh
docker compose up -d --build
```

Open <http://localhost:3000>. Enter the server setup key and choose the password for **technology**. There is no default password. Then use **Users & roles** to create department accounts and assign permissions. Temporary passwords must be changed at first sign-in.

After creating the administrator, clear `SETUP_TOKEN` in `.env` and run `docker compose up -d` again. Setup is also automatically blocked whenever an account exists. Never share or commit `.env`.

## Server deployment

- Set `APP_ORIGIN` to the exact public HTTPS origin, e.g. `https://announcements.example.com` (no trailing slash).
- Terminate TLS at your reverse proxy and proxy to `127.0.0.1:3000`, preserving the Host header. Compose binds only to loopback by default. If your proxy runs in another container, use a private Docker network rather than publishing the app to the internet.
- HTTPS is required for non-local origins; session cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS. API mutations verify the configured origin.
- Do not run multiple replicas against this SQLite volume. This initial standalone edition is intended for a single server/container.
- Authentication has per-username and conservative global limits (10 and 40 attempts per 15 minutes, including password changes). Add per-IP rate limiting at the reverse proxy for wider deployments. Untrusted forwarding/identity headers are never accepted for administrator setup.
- `/api/health` is the container health endpoint. It checks database availability without exposing account information.

## Data and backups

The named `tamam-data` volume stores SQLite accounts, roles, sessions, dashboard history, vendor data, and draft files. It survives container restarts and rebuilds. Do **not** use `docker compose down -v` unless you intend to permanently remove that data.

For a consistent backup, stop the app, back up the entire volume (database and `objects/` together), then restart. Restore the whole backup into a fresh volume before starting the app. Keep backups private. Migrations run transactionally on startup; changed, already-applied migrations are rejected. Back up before upgrades.

This copy starts with an empty database. It does **not** include or automatically connect to the hosted Sites accounts, passwords, saved drafts, uploads, or dashboard records. The hosted app is unchanged. Transferring its live data is a separate migration task.

## Development and checks

Use Node.js 24 or newer:

```sh
npm ci
npm run typecheck
npm run build
node scripts/test-standalone.mjs
```

For local development, set `APP_ORIGIN` and a random `SETUP_TOKEN` in your shell, then `npm run dev`. Data defaults to `./data`; override with `DATA_DIR` if needed. For production outside Docker use the same variables and `npm start` after building.

A ready-to-use GitHub Actions workflow is included at `docs/docker-workflow.yml`. To enable it, copy it to `.github/workflows/docker.yml` using a GitHub connection with workflow write permission (the current upload credential cannot create workflows). It builds the Docker image and tests first-time setup, login, authorization, department isolation, password reset, draft storage, and data persistence after a container restart. It does not deploy a server or publish a container-registry image.

To run the same container checks locally:

```sh
docker build -t tamam-announcement-builder:test .
node scripts/test-standalone.mjs --docker
```

## Assets and scope

The Tamam branding and supplied Effra fonts are preserved from the existing project. They are not granted an open-source redistribution license by this repository; confirm your organization's rights before redistributing them. No live data, default credentials, or environment secrets belong in source control.

Source baseline: hosted app commit `4b3e7b01af270b8a2fe98c0ad18fc38a5649082e`. This edition replaces Sites/Cloudflare storage with SQLite and a persistent filesystem volume; the editor and templates retain their existing behavior.
