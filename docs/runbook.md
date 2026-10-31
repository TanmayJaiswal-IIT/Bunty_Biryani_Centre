# Bunty Biryani Centre (BBC) — Production Operations Runbook

This runbook covers day-to-day operations, deployments, backups, emergency rollbacks, and incident response for Bunty Biryani Centre.

---

## 1. Hosting Architecture & Prerequisites

- **Platform**: Render (default) or Railway.
- **Region**: Singapore (`singapore` / `asia-southeast1`) — closest low-latency region to India.
- **Topology**:
  - Web Service: 1 Node.js instance (in-memory rate limiters rely on single instance). Paid starter tier to prevent idle sleep.
  - Database: Managed PostgreSQL 16+ (paid tier with daily automated backups).
- **Domain & URLs**:
  - Initial Render URL: `https://bbc-web.onrender.com`
  - Canonical Custom Domain (optional): `https://order.buntybiryani.com` (redirects automatically via canonical host middleware).

---

## 2. First Deploy Walkthrough

### Step 1: Render Setup
1. In Render Dashboard, click **New +** → **Blueprint**.
2. Connect the Git repository and select branch `main`.
3. Render reads `render.yaml` and provisions:
   - Web Service `bbc-web`
   - Postgres Database `bbc-db`
4. Set environment variable `APP_ORIGIN` in the Render dashboard to the deployed URL (e.g. `https://bbc-web.onrender.com`).
5. Trigger deploy. The build step (`pnpm build`) and pre-deploy migration (`pnpm db:deploy`) run automatically before traffic switches.

### Step 2: Railway Equivalent Setup (if deploying on Railway)
1. Create a project on Railway; connect the GitHub repository.
2. Select region `asia-southeast1`.
3. Add a PostgreSQL database plugin (`Postgres`).
4. Configure service build command:
   ```bash
   corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build
   ```
5. Configure pre-deploy command:
   ```bash
   pnpm db:deploy
   ```
6. Configure start command:
   ```bash
   pnpm start
   ```
7. Environment variables:
   - `NODE_ENV=production`
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - `JWT_SECRET=<generate 32+ character random secret>`
   - `APP_ORIGIN=https://<railway-domain>`

### Step 3: Initial Seed & Admin Account Creation
In the web service shell (Render Shell or `railway run`):
```bash
# 1. Seed initial locations (MSH & Kanhar) and default batch slots
pnpm db:seed:initial

# 2. Interactive admin account creation for Bunty (he enters his own password)
pnpm admin:create:prod
```

### Step 4: Run Smoke Test
Run the automated smoke test against the live origin:
```bash
pnpm smoke:test https://bbc-web.onrender.com
```

---

## 3. Backups & Disaster Recovery

### Automated Backups
- Paid Render Postgres creates daily snapshots retained per plan tier (7–30 days).

### Pre-Deployment Backup
Before deploying any release that introduces schema changes or database migrations:
```bash
# Using external database connection string in temporary session:
pg_dump --format=custom "$EXTERNAL_DATABASE_URL" -f bbc-$(date +%F).dump
```

### Tested Restore Drill Procedure
A backup that has never been restored does not count. Test restore procedure quarterly:
```bash
# 1. Spin up a fresh local restore verification database
docker compose exec db createdb -U bbc bbc_restore_test

# 2. Restore dump into verification database
pg_restore --clean --no-owner -d postgresql://bbc:bbc@localhost:5433/bbc_restore_test bbc-YYYY-MM-DD.dump

# 3. Verify table counts and data integrity
psql -U bbc -d bbc_restore_test -c "SELECT count(*) FROM orders; SELECT count(*) FROM menu_items;"

# 4. Clean up
docker compose exec db dropdb -U bbc bbc_restore_test
```

---

## 4. Deployments & Safe Rollback

### Zero-Downtime Deployment
- Deploys run from `main` after all CI tests pass.
- **Timing**: Never deploy between **6:30 PM and 9:30 PM IST** (peak batch cutoff and delivery rush).
- Render deploys with zero downtime: traffic remains on the old version until the new container passes `/api/health`.

### Expand/Contract Migration Policy
- All migrations must be backward-compatible (expand phase before contract phase).
- New columns must be optional (`NULL`) or have safe database defaults.
- This allows rolling back to the previous deployment immediately via Render Dashboard ("Rollback to this build") without touching the database schema.

---

## 5. Secret Management & Rotation

- **`JWT_SECRET` Rotation**:
  If suspected compromised, update `JWT_SECRET` in Render environment settings and redeploy. All active admin sessions are immediately invalidated; customers are unaffected.
- **Database Password Rotation**:
  Update database credentials in the managed database panel. Render automatically updates the internal `DATABASE_URL` via the `fromDatabase` reference.
- **Zero-PII Policy**:
  Production logs never output customer names, phone numbers, passwords, or request bodies.

---

## 6. Incident Playbook

| Symptom | Severity | Immediate Actions |
|---|---|---|
| **Uptime alert / Site down (502 / 503)** | CRITICAL | 1. Check Render status page and deploy logs.<br>2. Restart the web service.<br>3. If failure began immediately following a deploy, click **Rollback to previous version** in Render.<br>4. Notify Bunty to switch orders to WhatsApp if down for > 15 minutes. |
| **Orders failing / Customer errors** | HIGH | 1. Check server logs filtered by `requestId` (returned in client error modal).<br>2. Have Bunty toggle **Pause Orders** in the Admin Dashboard so customers see clear paused notice rather than unexpected errors.<br>3. Fix root cause and redeploy outside rush hours. |
| **Inventory discrepancy / overselling** | HIGH | 1. Run inventory sanity query: `SELECT id, name, daily_stock, stock_remaining FROM menu_items;`.<br>2. Check `stock_remaining >= 0`.<br>3. Bunty manually updates today's stock from `/admin/stock`. |
| **Prank order flood / spam** | MEDIUM | 1. Bunty activates **Pause Orders** from `/admin/settings`.<br>2. Identify spam orders in Today/Orders screen and click **Cancel** (food immediately returns to available stock).<br>3. Check if IP rate limits (`ORDER_RATE_LIMIT`) or phone caps need tightening in `src/shared/limits.ts`. |
| **Vendor locked out / phone lost** | MEDIUM | 1. Open Render Shell on `bbc-web`.<br>2. Run `pnpm admin:reset-password:prod` to reset credentials and revoke all active tokens. |
| **Database connection pool exhaustion** | MEDIUM | 1. Verify Prisma connection limit <= 10.<br>2. Restart web service to release hung connections.<br>3. If traffic has grown, upgrade Postgres plan to next tier. |

---

## 7. Monitoring & Health Checks

- **Health Endpoint**: `GET /api/health` queries `SELECT 1` on the primary database. Returns `200 {"status":"ok"}`.
- **Uptime Monitoring**: Configure external monitor (e.g., UptimeRobot, BetterUptime) to poll `GET /api/health` every 5 minutes with alert routing to developer email/SMS.
- **Log Inspection**: Every 500 error includes a unique `requestId` returned to the client and logged to stdout, allowing instant log correlation.
