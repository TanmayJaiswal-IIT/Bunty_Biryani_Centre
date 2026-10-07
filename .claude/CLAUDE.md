# Bunty Biryani Centre (BBC) — Phase 1 COD Ordering MVP

Mobile-first ordering site for a college food vendor. It replaces ordering over WhatsApp. Customers see today's menu and add items. They choose **Batch delivery** (a fixed daily slot per location, e.g. MSH 8:00 PM) or **Express delivery** (about 30–40 minutes, +₹30), pay **cash on delivery**, and get an order ID (`BB1023`) they can look up later. The vendor works alone. From a very simple dashboard he sees batch groups and express orders, marks orders completed / cash collected / cancelled, and manages menu, stock, slots and settings.

**Success test:** a customer orders in under a minute and knows exactly where and when the food arrives; the vendor sets up the day and works through the orders in a couple of minutes. Optimise for this, not for feature count. Phase 1 is done only when Bunty has run a real day of orders through it.

## Source of truth

| File | Read it when |
|---|---|
| `.claude/specs/Bunty_Biryani_Phase_Spec1.md` | The owner's Phase 1 brief (32 sections). Background for everything. |
| `.claude/specs/batch-01-architecture.md` | **Before any batch.** Architecture, stack and approved dependencies, layout, business rules (§6), Prisma schema + migration SQL (§7), API contracts and error codes (§8), security (§9), config (§11), decisions (§14), open questions (§15). |
| `.claude/specs/batch-02-setup-auth.md` | Tooling, scripts, local DB, migration process, seeds, admin CLI, server skeleton, auth, design tokens, base components. |
| `.claude/specs/batch-03-menu-cart.md` | `GET /api/menu`, menu screen, cart rules. |
| `.claude/specs/batch-04-checkout-delivery.md` | `GET /api/delivery-options`, availability rules, checkout page, order schemas. |
| `.claude/specs/batch-05-orders-inventory.md` | `inventory.service`, `createOrder`, idempotency, lookup, confirmation and track pages, concurrency tests. |
| `.claude/specs/batch-06-vendor-dashboard.md` | Status machine, dashboard grouping, admin APIs and screens. |
| `.claude/specs/batch-07-testing-polish.md` | Brief §29 traceability, Playwright, budgets, accessibility, polish, CI. |
| `.claude/specs/batch-08-deployment.md` | Render setup, runbook, smoke test, production verification, backups, incidents. |
| `.claude/assets/bbc-logo.png` | Brand source for all colours. |

- Read the batch spec, and the Batch 1 sections it cites, **before** writing code for that batch. The specs win over memory and guesses.
- Where the batch specs and the brief differ, the specs win; every deliberate difference is listed in Batch 1 §14. The brief's references to `ARCHITECTURE.md` and `prisma/schema.prisma` mean Batch 1 (until Batch 2 creates the schema file).
- If a decision changes during implementation, update the spec in the same change so code and specs never drift. After Batch 2, `prisma/schema.prisma` is the source of truth for columns, and Batch 1 §7.2 must be kept in sync.

## How we work

The project is built in batches (brief §31). Do **only the current batch**; don't scaffold or implement later batches early. After each batch: explain what was built, list the files changed, give the commands and the exact tests, and fix failures before moving on.

| Batch | Scope | Spec | Status |
|---|---|---|---|
| 1 | Architecture, database schema, API design | `batch-01-architecture.md` | Approved 2026-10-04 |
| 2 | Project setup, database, migrations + seed, admin authentication | `batch-02-setup-auth.md` | Built 2026-10-04; owner still to run `pnpm admin:create` in PowerShell (spec §13) |
| 3 | Customer menu + cart | `batch-03-menu-cart.md` | Built 2026-10-04; review gaps (§15) fixed and desktop runbook M1–M13 passed 2026-10-05; phone + TalkBack check moved to Batch 7 §13 (M7) |
| 4 | Checkout + batch/express delivery selection | `batch-04-checkout-delivery.md` | Built 2026-10-06; desktop runbook K1–K13 passed 2026-10-06; K14 (Enter key) and the phone + TalkBack check moved to Batch 7 §13 (M6) |
| 5 | Order creation + inventory | `batch-05-orders-inventory.md` | Built 2026-10-07; desktop runbook P1–P17 pending |
| 6 | Vendor dashboard + batch grouping (+ admin menu, stock, delivery settings) | `batch-06-vendor-dashboard.md` | — |
| 7 | Testing + mobile polish | `batch-07-testing-polish.md` | — |
| 8 | Deployment + production verification | `batch-08-deployment.md` | — |

Update the Status column when a batch is finished.

- Act as a senior full-stack engineer and product designer. Before implementing, point out architectural problems and missing edge cases, and push back on weak, insecure or inefficient requirements with a better option (brief §32).
- Keep Phase 1 small: one vendor, one admin, COD only. No Redis, queues, cron jobs, WebSockets, microservices or extra libraries.
- Online payment (Razorpay), OTP, push notifications, customer accounts and the rest of brief §28 are **out of scope**. Don't build hooks for them beyond what Batch 1 already allows (e.g. `paymentMethod` is an enum).
- Ask before adding a dependency that Batch 1 §4 doesn't list.

## Stack

- **One pnpm package** (no workspaces), one deployable. Express serves the built React app and `/api/*` from one origin (brief §23).
  - `src/client/`: React + Vite + TypeScript + Tailwind CSS v4, React Router, SWR.
  - `src/server/`: Node 24 LTS, Express 5, TypeScript (compiled with `tsc` to `dist/node`).
  - `src/shared/`: zod schemas, enums, limits, error codes, API types and formatters used by both sides (no Node or DOM APIs).
  - `prisma/`: schema, migrations, `seed-initial.ts`, `seed-dev.ts`; `prisma.config.ts` at the root. `scripts/`: admin CLI.
- **Database:** PostgreSQL 16+ with Prisma 7 (`prisma-client` generator into git-ignored `src/server/generated/prisma`, `@prisma/adapter-pg`), plus raw tagged-template SQL for stock operations.
- **Auth:** one admin; argon2id; JWT in an `HttpOnly`, `SameSite=Lax` cookie (`bbc_admin`).
- **Tests:** Vitest + supertest against real Postgres (Docker Compose); Playwright e2e (Batch 7).
- **Hosting:** Render (or Railway) paid web service + paid Postgres, Singapore region (Batch 8).

Folder layout: Batch 1 §5.

## Commands

As built in Batch 2 (spec §3.2).

```bash
docker compose up -d          # local Postgres 16 on host port 5433 (bbc_dev + bbc_test)
pnpm install                  # postinstall runs prisma generate (needs .env: copy .env.example, set JWT_SECRET)
pnpm db:migrate               # prisma migrate dev + prisma generate
pnpm db:seed                  # dev data: MSH + Kanhar slots, sample menu stocked for today
pnpm admin:create             # create the vendor login (interactive; needs a real terminal)
pnpm dev                      # client http://localhost:5173 (proxies /api) + API on PORT (.env)
pnpm test                     # unit + integration (real Postgres; refuses any DB not named *test*)
pnpm test:e2e                 # Playwright (Batch 7)
pnpm lint && pnpm typecheck
pnpm build && pnpm start:local   # production-style single process on PORT
```

Local ports: Postgres is on **5433** and the owner's PC also runs an unrelated Docker service on port 3000, so `.env` here uses `PORT=3100` and `APP_ORIGIN=http://localhost:3100` (both git-ignored; `.env.example` shows 3000). Check the database with `docker compose exec db psql -U bbc -d bbc_dev` (no host `psql`). Don't run `pnpm format` casually: it rewrites files (it is `prettier --write`).

Scripts must work in PowerShell as well as bash: no `VAR=value cmd`, no `rm -rf` (the owner develops on Windows).

## Rules that must never break

These protect food, cash and customers. Check every one in code review.

1. **Money is integer rupees** everywhere (DB, API, shared types). No floats, no paise. Format only for display, with `formatINR`.
2. **"Today" is the IST business date** (`Asia/Kolkata`), computed on the server from the injectable `clock`. Times of day are zero-padded `"HH:mm"` IST strings. The browser clock is never trusted, and the database `now()` is never used for business decisions.
3. **The server decides** price, delivery fee, total, stock, whether a slot is open, whether express is available, and whether orders are paused. The client sends `expectedTotal`; a mismatch is `PRICE_CHANGED`, never a silent change.
4. **Stock moves only through `inventory.service.ts`:** reserve with a conditional atomic decrement inside the order transaction; restore on cancel only for the item's current stock date; set today's stock with the single-statement SQL in Batch 1 §7.5. Stock belongs to a business date (`stockDate`); stock from another day is sold out. Keep the DB checks `stock_remaining >= 0` and `stock_remaining <= daily_stock`. Adding to the cart never touches the DB.
5. **Orders are created only by `order.service.createOrder`**, in one transaction, following Batch 1 §6.12 step by step. It's idempotent on `clientRequestId`, including retries that overlap the original (a rejected request re-checks the id before returning its error, §6.12 step 14). A failure leaves no order and no stock change.
6. **Locking:** order row first (`FOR UPDATE`), then menu items in ascending id order. Never take locks in another order.
7. **Order status and payment-status changes go only through `status-machine.ts`** (Batch 1 §6.9, Batch 6 §4). Cancel restores stock; same-state requests are no-ops.
8. **COD only:** never show or return "paid" for an order whose cash hasn't been collected. Customers see "Payment: CASH ON DELIVERY"; the vendor sees "COD · Pending / Collected".
9. **Batch orders are never merged**, and express orders never have a slot or join a batch group. Grouping happens only in dashboard queries.
10. **Every `/api/admin/*` route except login sits behind `requireAdmin`**, and admin writes (and login) also pass the Origin check. Frontend route guards are UX only.
11. **No secrets in the frontend or the repo.** Secrets live in env vars validated at boot. Logs never contain request bodies, phone numbers, passwords or cookies.
12. **No `$queryRawUnsafe` / `$executeRawUnsafe`.** Raw SQL uses Prisma tagged templates only.
13. **Nothing business-specific is hard-coded.** Locations (MSH, Kanhar), slots, items, prices, fees, ETA and express hours are data managed from the admin. Validation and abuse limits are constants in `src/shared/limits.ts`.
14. **Orders snapshot** item names, unit prices, location name, slot time and express ETA. History never changes when the menu, locations or slots change. Nothing is ever hard-deleted.
15. **Migrations:** create with `prisma migrate dev --create-only` and review the SQL. Keep the hand-written CHECK constraints, `order_number_seq` and the settings row (Batch 1 §7.3). Never edit an applied migration. Keep schema changes backward compatible (expand/contract) so a rollback is safe.
16. **Validation** uses the zod schemas in `src/shared/` on both sides; don't duplicate them. Admin schemas are strict (unknown keys rejected).

## Frontend guidelines

- **Mobile-first and fast over flashy** (brief §24). Design at 360 px; no horizontal scroll from 320 px. Budgets (Batch 1 §10.5): `/` first-load JS ≤ 130 KB gzipped, Lighthouse mobile Performance ≥ 90 and Accessibility ≥ 95. No animation, UI-kit, icon or global-state libraries.
- **Brand tokens come from the logo** (Batch 2 §9):
  - red `#C8323A` for actions;
  - flat gold accents (never metallic gradients, never text);
  - espresso-brown text;
  - sun-yellow and cream backgrounds.
  Use the CSS tokens, never raw hex values in components.
- **Fonts** (self-hosted): Archivo for display text (uppercase headings, brand name, order ID) and Inter for UI text and all prices. The Inter subset must include `₹`.
- **Errors:** red is also the brand colour, so error states always use `--color-danger` + an icon + the soft danger background.
- **Brand name:** "Bunty Biryani Centre", spelled as on the logo (the brief says "Center").
- **States:** every screen has loading (skeletons), empty and error states (with retry), plus the paused / unavailable messages where they apply. All copy lives in `src/client/copy.ts`; the brief's fixed phrases (§4, §9, §10, §11) are used verbatim.
- **Touch:** targets ≥ 48 px; inputs 16 px; the sticky bottom bar never covers a focused field.
- **Imports:** customer code must never import from `features/admin`; admin routes are lazy-loaded.

## Testing expectations

- New backend behaviour comes with integration tests against real Postgres. After every test that touches stock or orders, the inventory invariant query (Batch 1 §7.5) must return zero rows.
- Keep the concurrency tests green: the last-item race, ten buyers for five items, opposite-order carts, concurrent duplicate `clientRequestId` (including for the last item), and concurrent double cancel (Batch 5 §12, Batch 6 §9).
- Time-dependent tests use the injectable clock (`CLOCK_OVERRIDE` in e2e, only honoured when `NODE_ENV=test`).
- Customer and vendor journeys are covered by Playwright (Batch 7 §5). Every brief §29 item maps to a test (Batch 7 §3).
- Run the relevant tests before saying something works.

## Open questions for the owner

Listed in Batch 1 §15: express hours, per-phone order cap, the help number shown to customers, item photos, hosting budget, domain, how the vendor hears about new orders, phone-number retention, real menu and prices, customer cancellation. Use the documented defaults until they're answered.
