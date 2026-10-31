# Batch 1 — Architecture, database schema and API design

| | |
|---|---|
| Status | Written 2026-10-04 from the Phase 1 brief. Reviewed and approved 2026-10-04 (review fixes: §6.12 step 14, lookup limit, Prisma 7, D19). |
| Brief sections | Designs §1–§3, §8, §14–§16, §20–§23, §25–§28. §13 maps every brief section to a batch. |
| Produces | This document. No application code. |
| Next | Batch 2 turns §4, §5, §7, §9 and §11 into a running skeleton. |

This is the reference spec. Later batch specs say *how to build* their slice and point back here for rules, schema and API contracts. Where this document and the brief (`Bunty_Biryani_Phase_Spec1.md`) differ, this document wins, and every deliberate difference is listed in §14. The brief's references to `ARCHITECTURE.md` and `prisma/schema.prisma` mean this document until Batch 2 creates the real schema file. After that, `prisma/schema.prisma` is the source of truth for columns and §7.2 must be updated in the same change as any schema edit.

---

## 1. Product in one page

Bunty Biryani Centre (BBC) is a college food vendor. Phase 1 replaces ordering over WhatsApp with a mobile-first site:

- **Customers** open the site, see today's menu, add items, choose **Batch** or **Express** delivery, enter name and phone, place a **cash-on-delivery (COD)** order and get an order ID (`BB1023`). They can look the order up later with order ID + phone.
- **The vendor** (one person) logs into a private dashboard, sees batch groups and express orders, prepares and delivers, marks orders completed / cash collected / cancelled, and manages menu, stock, slots and settings.

**Success test:** a customer orders in under a minute and knows exactly where and when the food arrives; the vendor sets up the day and works through the orders in a couple of minutes.

### 1.1 Glossary

| Term | Meaning |
|---|---|
| Batch delivery | Individual orders delivered on a fixed recurring daily **slot** (location + delivery time + cutoff). The vendor makes one trip per slot and hands out the individual orders. |
| Express delivery | An individual order delivered roughly 30–40 minutes after it is placed, for an extra fee (default ₹30). Never part of a batch. |
| Slot | A recurring daily rule: location, delivery time, cutoff time, active flag, optional "closed today" date. |
| Batch group | All non-cancelled orders with the same delivery date, slot and snapshotted slot time. Derived in queries, never stored. |
| Business date | The calendar date in `Asia/Kolkata` (IST) at the moment of the request, computed on the server. Phase 1 orders are always for today's business date. |
| Cutoff | The last minute (exclusive) at which a batch slot accepts orders. At `cutoffTime` exactly, the slot is closed. |
| Order ID | `orderNumber`, `BB` + a database sequence starting at 1001. Customer-facing. The internal numeric `id` is used only in admin URLs. |
| Bulk | An old name for batch delivery. There is no catering or bulk-quotation workflow (brief §27). |
| Vendor / admin | The single dashboard user. "Bunty" in the brief. |

---

## 2. Scope

### 2.1 In scope (brief §2)

**Customer:** today's menu, cart, Batch or Express, location + slot (Batch) or location (Express, +fee), name + phone + optional room/address, COD order, order ID + summary, lookup by order ID + phone.

**Vendor:** login; today's dashboard with batch groups (order count, item count, COD total, per-item breakdown) and express orders (order time, approximate window); mark completed, mark cash collected, cancel (restores stock); manage menu, today's stock, locations, slots, express on/off, fees, express ETA and hours, pause all orders.

### 2.2 Out of scope for Phase 1

From brief §28: online payments (Razorpay is Phase 2), customer accounts, OTP, WhatsApp API, native apps, loyalty, coupons, analytics, catering quotations, multi-vendor, delivery tracking, driver app, kitchen workflow.

This spec also rules out: orders for a future date, customer-initiated cancellation, push notifications, image uploads (items take an image URL; see D10), more than one admin account, refunds, printing, CSV export.

---

## 3. Architecture

```
 Customer / vendor phone (Android Chrome first)
        │  HTTPS, one origin
        ▼
 ┌──────────────────────────────────────────────┐
 │ Web service (Node 24 LTS, Express 5)          │
 │   /api/*      JSON API, zod-validated         │
 │   /assets/*   Vite build output (immutable)   │
 │   /*          index.html (SPA fallback)       │
 │                                               │
 │   routes ──▶ services ──▶ Prisma / raw SQL    │
 └──────────────────────┬───────────────────────┘
                        ▼
              Managed PostgreSQL 16+
```

### 3.1 Principles

1. **One deployable, one origin** (brief §23). Express serves the built React app and the API. No CORS, no cross-site cookies, one thing to deploy and monitor.
2. **The server is the only authority** for prices, fees, totals, stock, slot open/closed, express availability, pause state and the current time. The browser shows what the server says and re-asks before acting.
3. **Thin routes, owning services.** Routes parse and validate input with the shared zod schemas, call one service function and shape the response. Services own business rules and transactions. Routes never write to the database directly.
4. **One shared module** (`src/shared`) holds zod schemas, enums, limits, error codes, API types and formatters. It is pure TypeScript with no Node or DOM APIs, so both sides import it.
5. **Postgres is the only state store.** No Redis, queues, cron jobs or WebSockets. The single exception is the in-memory rate-limit counters, which are acceptable for one instance and reset on deploy (see §9.4).
6. **Time comes from one injectable clock** (`clock.now()`), never from `new Date()` scattered through services and never from the database's `now()` for business decisions. Tests and e2e runs control it (§6.2).

### 3.2 Order request, end to end

1. The customer taps **Place order**. The browser sends `POST /api/orders` with a `clientRequestId` (UUID), details, delivery choice, item ids + quantities and the `expectedTotal` it displayed.
2. Express runs the IP rate limit, parses JSON (10 KB limit) and validates the body with `createOrderSchema` from `src/shared`.
3. `order.service.createOrder()` first checks idempotency (a replay returns the existing order), then opens one database transaction and runs the steps in §6.12: pause check, delivery rules, per-phone cap, item check, stock reservation through `inventory.service`, fee and total, `PRICE_CHANGED` check, insert with snapshots.
4. Any failure throws a typed `AppError`, the transaction rolls back and the error handler returns `{ error: { code, message, details } }`. No partial order or stock change can survive.
5. Success returns `201` with the public order view. A replay of the same `clientRequestId` returns `200` with the same order.

### 3.3 Capacity

A campus vendor sees tens to low hundreds of orders a day with short peaks before cutoffs. One small instance and one small Postgres are plenty. Running two or more instances would need the rate-limit store moved into Postgres; nothing else changes.

---

## 4. Stack and approved dependencies

Versions are the current stable major at the start of Batch 2, pinned exactly in `package.json`. Adding anything not listed here needs owner approval first.

| Area | Choice |
|---|---|
| Runtime | Node.js 24 LTS (`engines.node: ">=24 <25"`) |
| Package manager | pnpm (`packageManager` field set), single package (no workspaces) |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` |
| Frontend | React, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), React Router (library mode), SWR |
| Backend | Express 5 |
| Database | PostgreSQL 16+, Prisma ORM 7 (`prisma-client` generator, `@prisma/adapter-pg` driver adapter, `prisma.config.ts`; §7.2); raw SQL only through Prisma tagged templates |
| Validation | zod v4 (switch shared schemas to `zod/mini` if the bundle budget in Batch 7 needs it) |
| Auth | `argon2` (password hashing), `jose` (JWT), `cookie-parser` |
| Hardening | `helmet`, `express-rate-limit` |
| Tests | Vitest, supertest, Playwright (`@playwright/test`, Batch 7) |
| Dev tooling | `tsx` (dev server, scripts), ESLint (flat config) + `typescript-eslint` + `eslint-plugin-react-hooks`, Prettier |

**Runtime dependencies:** `react`, `react-dom`, `react-router`, `swr`, `zod`, `express`, `@prisma/client`, `@prisma/adapter-pg` (brings in `pg`), `argon2`, `jose`, `cookie-parser`, `express-rate-limit`, `helmet`. Batch 2 confirmed that the generated Prisma 7 client imports its runtime from `@prisma/client/runtime/client`, so `@prisma/client` is needed.

**Pinned in Batch 2 (2026-10-04):** react and react-dom 19.3.0, react-router 8.4.0 (everything imported from `react-router`; `react-router-dom` no longer exists), swr 2.5.1, zod 4.6.5, express 5.2.1, prisma, `@prisma/client` and `@prisma/adapter-pg` 7.10.0, argon2 0.45.1, jose 6.2.12, cookie-parser 1.4.7, express-rate-limit 8.7.0, helmet 8.3.0; dev: typescript **6.0.3**, tsx 4.23.15, vite 8.3.2, @vitejs/plugin-react 6.1.1, tailwindcss and @tailwindcss/vite 4.3.3, vitest 5.0.3, supertest 7.3.1, eslint 10.12.0, typescript-eslint 8.71.0, eslint-plugin-react-hooks 7.1.1, prettier 3.9.9, @types/node 24.19.1. Two pins matter: **`prisma` must stay on 7.10.0** (npm's `latest` tag for the CLI is an 8.0 release candidate), and **TypeScript stays on 6.x** until typescript-eslint supports 7 (its peer range is `<6.1.0`, and the type-checked lint rules catch unhandled promises in Express handlers). TypeScript 6 no longer loads every `@types/*` package, so each tsconfig lists its `types`.

**Dev dependencies:** `typescript`, `tsx`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `prisma`, `vitest`, `supertest`, `@playwright/test`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `@types/node`, `@types/express`, `@types/cookie-parser`, `@types/supertest`, `@types/react`, `@types/react-dom`.

Deliberately **not** used: Next.js, UI kits, animation libraries, global-state libraries, date libraries (IST is a fixed UTC+05:30 offset; `Intl` is enough), `cors` (same origin), a logger library (a 20-line JSON logger is enough), `concurrently` (pnpm runs scripts in parallel), `dotenv` (Node's `--env-file` and `process.loadEnvFile()` cover it).

---

## 5. Repository layout

```
/
├─ package.json             scripts, deps, engines, packageManager
├─ tsconfig.base.json       shared compiler options
├─ tsconfig.json            solution file: references the three configs below (editor, typescript-eslint)
├─ tsconfig.client.json     client + shared (Vite)
├─ tsconfig.server.json     server + shared + scripts + seeds, emits dist/node
├─ tsconfig.test.json       tests + *.config.ts, no emit
├─ vite.config.ts           root: src/client, outDir: dist/client, /api proxy in dev
├─ vitest.config.ts         unit + integration projects
├─ playwright.config.ts     Batch 7
├─ prisma.config.ts         Prisma 7 CLI config: schema + migrations paths, DATABASE_URL (§7.2)
├─ eslint.config.js
├─ docker-compose.yml       local Postgres 16 with bbc_dev + bbc_test
├─ .env.example
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  ├─ seed-dev.ts           sample menu, MSH + Kanhar, today's stock (dev only)
│  └─ seed-initial.ts       MSH + Kanhar slots only; idempotent, safe in production
├─ scripts/
│  ├─ admin-create.ts       interactive: username + password
│  └─ admin-reset-password.ts  also bumps tokenVersion (logs out every device)
├─ src/
│  ├─ shared/               pure TS, imported by client and server
│  │  ├─ enums.ts           DeliveryMode, OrderStatus, PaymentStatus, PaymentMethod
│  │  ├─ limits.ts          abuse and validation limits (§6.11)
│  │  ├─ errors.ts          ErrorCode union + HTTP status map
│  │  ├─ money.ts           formatINR
│  │  ├─ time.ts            HH:mm helpers, formatTime12h, formatWindow, etaText
│  │  ├─ phone.ts           normalizeIndianMobile
│  │  ├─ pricing.ts         computeTotals (pure arithmetic shared by both sides)
│  │  ├─ schemas/           zod: auth.ts, menu.ts, delivery.ts, order.ts, admin.ts
│  │  └─ api-types.ts       response types (inferred where possible)
│  ├─ server/
│  │  ├─ index.ts           boot: config, Prisma, listen, graceful shutdown
│  │  ├─ app.ts             createApp({ prisma, clock, config }) — used by tests
│  │  ├─ config.ts          env parsing with zod; fails fast at boot
│  │  ├─ db.ts              Prisma client factory (PrismaClient + PrismaPg adapter)
│  │  ├─ generated/prisma/  output of `prisma generate` (git-ignored, §7.2)
│  │  ├─ lib/               clock.ts, app-error.ts, logger.ts, db-date.ts
│  │  ├─ middleware/        require-admin.ts, origin-check.ts, rate-limits.ts,
│  │  │                     validate.ts, error-handler.ts, request-log.ts
│  │  ├─ routes/            health.ts, menu.ts, delivery.ts, orders.ts,
│  │  │                     admin/{auth,dashboard,orders,menu,stock,locations,slots,settings}.ts
│  │  ├─ services/          auth.service.ts, menu.service.ts, delivery.service.ts,
│  │  │                     order.service.ts, inventory.service.ts, status-machine.ts,
│  │  │                     dashboard.service.ts, settings.service.ts
│  │  └─ static.ts          serves dist/client + SPA fallback in production
│  └─ client/
│     ├─ index.html
│     ├─ main.tsx, App.tsx  router
│     ├─ styles/            index.css (Tailwind import + @theme tokens), fonts.css
│     ├─ assets/            logo-96.webp, logo-192.webp, fonts/*.woff2
│     ├─ lib/               api.ts, storage.ts, uuid.ts, use-business-date.ts
│     ├─ copy.ts            every customer- and vendor-facing string
│     ├─ components/        Button, TextField, RadioCard, Banner, QtyStepper,
│     │                     Skeleton, ErrorState, EmptyState, ConfirmDialog, Price
│     └─ features/
│        ├─ customer/       menu/, cart/, checkout/, order/
│        └─ admin/          lazy-loaded: auth/, layout/, today/, orders/, stock/,
│                           menu/, delivery/
└─ tests/
   ├─ helpers/              db reset, factories, test clock, invariant check
   ├─ unit/
   ├─ integration/          supertest against real Postgres
   └─ e2e/                  Playwright (Batch 7)
```

Rules:

- `src/shared` must not import from `src/server` or `src/client`.
- Customer code (`features/customer`, `components`) must never import from `features/admin`. Admin routes are loaded with `React.lazy`, so the customer bundle never contains admin code.
- The server, CLI scripts and initial seed are compiled by `tsc -p tsconfig.server.json` (NodeNext ESM) into `dist/node`, so production never needs `tsx`. Relative imports use the `.js` extension. The client imports shared code through the `@shared/*` alias; the server uses relative paths.
- `src/server/generated/` is build output: git-ignored, excluded from lint and from the stock-writes guard (Batch 5 §3). Routes never import it; they call services.

---

## 6. Business rules

Each rule has an id so code reviews and tests can cite it.

### 6.1 Money

- **M1.** All money is **integer rupees** (brief §8): `price`, `foodSubtotal`, `deliveryFee`, `total`, `expressFee`, `batchFee`. No floats, no paise, no decimal types.
- **M2.** Format only for display with `formatINR(n)` → `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })` → `₹330`, `₹1,340`.
- **M3.** Phase 2 (Razorpay) converts at the payment adapter boundary (`amount * 100`). Phase 1 stores no paise.

### 6.2 Time and the business date

- **T1.** The business date and time of day are computed on the server in `Asia/Kolkata` from `clock.now()`. The browser clock is never trusted (brief §10).
- **T2.** `nowIST()` returns `{ instant: Date, date: 'YYYY-MM-DD', time: 'HH:mm' }` using `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', … })`. Always use `hourCycle: 'h23'`; `hour12: false` can produce `24:00`.
- **T3.** Times of day are zero-padded `HH:mm` strings (`"07:30"`, `"20:00"`). Zero-padded strings compare correctly with `<`, both in TypeScript and in SQL with `COLLATE "C"`.
- **T4.** Times never cross midnight in Phase 1: `cutoffTime < deliveryTime` and `expressOpensAt < expressClosesAt` within one day.
- **T5.** In code, a business date is the string `'YYYY-MM-DD'`. Convert to a JS `Date` only at the Prisma boundary with `toDbDate()` / `fromDbDate()` in `lib/db-date.ts` (UTC midnight). Raw SQL takes the string with a `::date` cast.
- **T6.** Business timestamps (`createdAt`, `completedAt`, `cancelledAt`, `collectedAt`) are set from `clock.now()` in the service, not by the database default. This keeps the express window consistent with the business clock in tests.
- **T7.** `clock` honours `CLOCK_OVERRIDE` (an ISO instant; time runs forward from it) **only when `NODE_ENV=test`**. Config validation refuses to boot in production if it is set.

### 6.3 Menu and availability

- **MN1.** A menu item is on today's customer menu if `isActive` (not deleted) and `isAvailable` (vendor enabled it).
- **MN2.** An item on the menu is **sold out** if `stockDate ≠ today` or `stockRemaining = 0`. Sold-out items stay visible, greyed out and not orderable (brief §13). They are listed after orderable items, each group in `sortOrder` then name.
- **MN3.** Disabled (`isAvailable = false`) and deleted (`isActive = false`) items are hidden from customers. Delete is soft (brief §18).
- **MN4.** The customer may order at most `min(stockRemaining, MAX_QTY_PER_ITEM)` of an item. The API exposes this as `maxQty`, plus `onlyLeft` when the item is orderable (not sold out) and `stockRemaining ≤ 5`.

### 6.4 Stock (inventory)

- **S1.** Columns: `dailyStock` (what the vendor set for `stockDate`), `stockRemaining`, `stockDate`. Sold for that date = `dailyStock − stockRemaining`.
- **S2.** **Stock belongs to a business date (D1).** If `stockDate ≠ today`, the item is sold out until the vendor sets today's stock. This is not a reset job; it stops yesterday's leftovers being sold before the vendor has set up the day. The brief's "no automatic daily reset" still holds: nothing runs at midnight.
- **S3.** **Set today's stock to N:**
  - if `stockDate ≠ today` (new day): `dailyStock = N`, `stockRemaining = N`, `stockDate = today`;
  - if `stockDate = today` (adjusting): `sold = dailyStock − stockRemaining`; reject with `STOCK_BELOW_SOLD` if `N < sold`; else `dailyStock = N`, `stockRemaining = N − sold`.
  Both paths are one SQL statement (§7.5) so a concurrent order cannot slip between read and write.
- **S4.** **Reserve on order:** inside the order transaction, for each line in ascending `menuItemId`, run a conditional atomic decrement (`stockRemaining >= qty AND stockDate = today AND isActive AND isAvailable`). Zero rows updated aborts the whole transaction (brief §14, §25).
- **S5.** **Restore on cancel:** add the order's quantities back **only if** `order.deliveryDate = item.stockDate` (D2). Cancelling yesterday's order must not inflate today's stock. Restore item by item in ascending `menuItemId`.
- **S6.** Database checks are the last line of defence: `stock_remaining >= 0`, `daily_stock >= 0`, `stock_remaining <= daily_stock`.
- **S7.** Only `inventory.service.ts` writes `daily_stock`, `stock_remaining` or `stock_date`. A test fails the build if any other server file does (Batch 5).
- **S8.** **Invariant** (checked after every integration test): for each item with a `stockDate`, `dailyStock − stockRemaining` equals the sum of quantities in non-cancelled orders for that item and date. Query in §7.5.

### 6.5 Batch delivery slots

- **B1.** Slots are recurring daily rules stored in the database (brief §5): `locationId`, `deliveryTime`, `cutoffTime`, `isActive`, `closedOn`. Nothing about slots is hard-coded in the frontend.
- **B2.** `cutoffTime < deliveryTime`, validated by zod on save and by a database check.
- **B3.** A slot is **open now** if: `ordersPaused = false` **and** `slot.isActive` **and** `location.isActive` **and** `slot.closedOn ≠ today` **and** `now.time < cutoffTime`.
- **B4.** Closed reasons `GET /api/delivery-options` reports: `CUTOFF_PASSED`, `CLOSED_TODAY`. Inactive slots and slots at inactive locations are not listed to customers; if an order names one anyway, `POST /api/orders` rejects it with reason `INACTIVE` (§6.12 step 5).
- **B5.** **Close for today (D3):** the vendor can close a slot for today only (`closedOn = today`). It reopens automatically the next day. `isActive = false` turns it off until turned back on.
- **B6.** `(locationId, deliveryTime)` is unique. Slots are never deleted (orders reference them); they are deactivated.
- **B7.** Editing a slot's time affects new orders only. Existing orders keep `slotDeliveryTime`. If today has open orders on that slot, the admin UI warns first (Batch 6).
- **B8.** Every order is its own row. Orders for the same slot are **grouped on the dashboard, never merged** (brief §6).

### 6.6 Express delivery

- **E1.** Express is **available now** if `ordersPaused = false` **and** `expressEnabled` **and** `expressOpensAt <= now.time < expressClosesAt` (express hours, D4).
- **E2.** Express needs a delivery location (any active location). It has no slot and never joins a batch group (brief §7).
- **E3.** ETA text is generated: `` `${min}–${max} minutes` `` (en dash). The customer is never shown an exact ETA.
- **E4.** The order snapshots `expressEtaMinMinutes` and `expressEtaMaxMinutes`. The delivery window is `createdAt + min` to `createdAt + max`, shown in IST as "approx. 7:40–7:50 PM".
- **E5.** An active express order is **late** when `now > createdAt + max` and its status is still `ORDER_RECEIVED`. The dashboard highlights it.

### 6.7 Fees and totals

- **F1.** `foodSubtotal = Σ unitPrice × quantity` using prices read from the database inside the order transaction (from the locked row returned by the stock decrement).
- **F2.** `deliveryFee = batchFee` for Batch and `expressFee` for Express, read from settings inside the transaction (brief §8).
- **F3.** `total = foodSubtotal + deliveryFee`, enforced by a database check.
- **F4.** The client sends `expectedTotal`, the total it displayed. If the server's total differs, the order is rejected with `PRICE_CHANGED` and the new total (D6). The customer never pays more than they saw.
- **F5.** The frontend's totals are for display only. Both sides use `computeTotals()` from `src/shared/pricing.ts` for the arithmetic; only the server's inputs count.

### 6.8 Pausing

- **P1.** `ordersPaused = true` stops all new orders, batch and express. Customers can still browse the menu, with the banner "Orders are temporarily paused. Please check again shortly." Checkout is disabled.
- **P2.** `expressEnabled = false` stops express only. Customers see "Express delivery is currently unavailable." Batch continues.
- **P3.** Pausing never touches existing orders.

### 6.9 Order lifecycle

Order status (brief §16):

| From | To | Who | Side effects | Allowed when |
|---|---|---|---|---|
| — | `ORDER_RECEIVED` | customer | stock reserved | order created |
| `ORDER_RECEIVED` | `COMPLETED` | vendor | `completedAt = now` | always |
| `COMPLETED` | `ORDER_RECEIVED` | vendor ("Reopen", for mis-taps, D11) | `completedAt = null` | always |
| `ORDER_RECEIVED` | `CANCELLED` | vendor | stock restored (S5), `cancelledAt = now` | `paymentStatus = PENDING` |

`CANCELLED` is terminal. Cancelling a completed order means reopening it first. Cancelling an order whose cash was collected means undoing "cash collected" first, so an order is never both cancelled and paid.

Payment status (brief §3):

| From | To | Allowed when | Side effects |
|---|---|---|---|
| `PENDING` | `COLLECTED` | status ≠ `CANCELLED` | `collectedAt = now` |
| `COLLECTED` | `PENDING` | status ≠ `CANCELLED` (undo, D11) | `collectedAt = null` |

- **L1.** All status and payment changes go through `status-machine.ts`, which locks the order row (`SELECT … FOR UPDATE`) before checking the transition, so two taps can't cancel and restore stock twice.
- **L2.** Disallowed transitions return `409 INVALID_TRANSITION`.
- **L3.** Cancelled orders are excluded from every dashboard count and total (brief §16).
- **L4.** There is no NEW → CONFIRMED → PREPARING → … workflow.
- **L5.** Asking for the state an order is already in (completing a completed order, cancelling a cancelled one) is a no-op that returns the order unchanged, so double taps and two devices are harmless. A no-op cancel never restores stock twice.

### 6.10 Payment (COD)

- **C1.** `paymentMethod` is always `COD` in Phase 1. It is an enum so Phase 2 can add `ONLINE`.
- **C2.** The customer sees **"Payment: CASH ON DELIVERY"** (the brief's wording, uppercase; **(as built, Batch 4)** aligned from "Cash on delivery"). After the vendor marks it collected, the lookup page shows "Cash on delivery · Collected".
- **C3.** The vendor sees **"COD · Pending"** or **"COD · Collected"**.
- **C4.** No screen, API field or log line ever says "paid" for an order whose cash has not been collected.

### 6.11 Limits and abuse protection

Constants in `src/shared/limits.ts`. They are validation rules, not business data, so they live in code.

| Constant | Value | Why |
|---|---|---|
| `MAX_QTY_PER_ITEM` | 10 | brief §25 |
| `MAX_LINES_PER_ORDER` | 10 | brief §25 ("cap on lines") |
| `LOW_STOCK_THRESHOLD` | 5 | MN4: the menu shows "Only N left" at or below this (`onlyLeft`) |
| `MAX_OPEN_ORDERS_PER_PHONE` | 3 | open (`ORDER_RECEIVED`) orders per phone for today; prank limiter (D7) |
| `NAME_MIN` / `NAME_MAX` | 2 / 60 | after trimming and collapsing spaces |
| `ADDRESS_MAX` | 120 | room / hostel / landmark |
| `ORDER_RATE_LIMIT` | 60 per 10 min per IP | generous on purpose: a hostel's students share one Wi-Fi NAT IP; this stops scripts, not people |
| `LOOKUP_RATE_LIMIT` | 30 **failed** lookups per 10 min per IP | stops order-number enumeration. Only failed lookups count (`skipSuccessfulRequests`): the confirmation page refreshes through lookup (Batch 5 §8.1) and a hostel's students share one Wi-Fi IP, so counting successes would lock out real customers |
| `LOGIN_RATE_LIMIT` | 10 **failed** logins per 15 min per IP | brief §22; successful logins don't count (Batch 2 §7.1) |

Phone numbers: Indian mobile. `normalizeIndianMobile()` strips spaces, dashes, a leading `+91`, `91` (12 digits) or `0` (11 digits), then requires `^[6-9]\d{9}$`. The stored and compared form is the 10 digits.

There is no OTP or WhatsApp verification in Phase 1 (brief §26). The vendor can cancel any order.

### 6.12 Order creation algorithm (expands brief §25)

`order.service.createOrder(input, { ip })` runs in one Prisma interactive transaction (Read Committed, 10 s timeout):

1. **Idempotency fast path (before the transaction):** if an order with `clientRequestId` exists, return it with `replayed: true` if its phone matches the request; otherwise `409 IDEMPOTENCY_CONFLICT`. This runs before the pause check on purpose (D19): a customer retrying after a network drop gets the order that was placed, even if orders were paused in between.
2. Read settings. If `ordersPaused` → `409 ORDERS_PAUSED`.
3. Validated input arrives from the route. Merge duplicate `menuItemId` lines by summing quantities; re-check `MAX_QTY_PER_ITEM` after merging (`400`).
4. Compute `today = nowIST()`.
5. **Delivery rules.** BATCH: load slot + location; the slot must belong to `locationId` (`400`), be active and at an active location (`409 SLOT_CLOSED`, reason `INACTIVE` / `409 LOCATION_UNAVAILABLE`), not closed today (`409 SLOT_CLOSED`, `CLOSED_TODAY`), and `today.time < cutoffTime` (`409 SLOT_CLOSED`, `CUTOFF_PASSED`). EXPRESS: express must be available (`409 EXPRESS_UNAVAILABLE`, reason `DISABLED` or `OUTSIDE_HOURS`); the location must be active (`409 LOCATION_UNAVAILABLE`). The zod schema already rejects a `slotId` on express.
6. **Per-phone cap:** count today's `ORDER_RECEIVED` orders for the phone. At or over `MAX_OPEN_ORDERS_PER_PHONE` → `429 TOO_MANY_OPEN_ORDERS`. (Soft limit: two simultaneous requests can both pass. Acceptable.)
7. **Item pre-check:** `SELECT` the requested items. Unknown, deleted or disabled → `409 ITEM_UNAVAILABLE` with all such ids. Not enough stock for today (sold out, `stockDate ≠ today`, or short) → `409 OUT_OF_STOCK` with `{ menuItemId, name, available }` for **every** short item, so the client can fix the whole cart at once.
8. **Reserve:** `inventory.reserveStock(tx, today.date, lines)` decrements each line in ascending `menuItemId` (S4) and returns `{ id, name, price }` from the updated rows. A zero-row update (lost race) → `409 OUT_OF_STOCK` for that item with its current `available`.
9. **Totals:** subtotal from the returned prices (F1), fee from settings (F2), total (F3).
10. **Price check:** `total ≠ expectedTotal` → `409 PRICE_CHANGED` with `{ total }`. The transaction rolls back, so stock is untouched.
11. **Insert** the order with snapshots (location name, slot time, ETA minutes, item names, unit prices, line totals) and `createdAt = today.instant`. The database fills `orderNumber`.
12. Commit, return `201` with the public order view.
13. **Unique-violation fallback:** if the insert fails on `client_request_id` (a concurrent duplicate won the race), the transaction has rolled back; load the winning order and return it as in step 1.
14. **Rejection re-check:** if steps 2–11 reject the order with any `AppError`, the transaction has rolled back; look up `clientRequestId` once more before returning the error. If an order now exists, apply step 1's rules (replay when the phone matches, `IDEMPOTENCY_CONFLICT` otherwise); if not, return the original error. Why: a retry that overlaps the original request waits on the original's stock row lock, then sees the original's effects (stock gone, per-phone cap reached) and would otherwise report `OUT_OF_STOCK` or `TOO_MANY_OPEN_ORDERS` for an order that exists. Step 13 only covers duplicates that get as far as the insert. The cost is one indexed read, on rejections only.

Sequence numbers consumed by rolled-back transactions leave gaps (`BB1004` may never exist). This is expected and harmless.

---

## 7. Data model

### 7.1 Entities

```
Admin

DeliveryLocation 1───* DeliverySlot
       │                   │
       │ 1                 │ 0..1
       *                   *
     Order ────────────────┘
       │ 1
       *
   OrderItem *───1 MenuItem

DeliverySettings (exactly one row, id = 1)
```

Naming: Prisma models and fields are camelCase; tables and columns are snake_case via `@@map` / `@map`, so raw SQL reads naturally (`stock_remaining`). Raw SQL that updates a row must also set `updated_at = now()`, because Prisma's `@updatedAt` only applies to Prisma client writes.

### 7.2 Prisma schema

```prisma
generator client {
  provider            = "prisma-client"                  // Prisma 7.10.0 (as built); output compiles under TypeScript 6 strict
  output              = "../src/server/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"                             // NodeNext ESM (§5)
}

datasource db {
  provider = "postgresql"                                // the URL lives in prisma.config.ts (Prisma 7)
}

enum DeliveryMode {
  BATCH
  EXPRESS
}

enum PaymentMethod {
  COD
}

enum PaymentStatus {
  PENDING
  COLLECTED
}

enum OrderStatus {
  ORDER_RECEIVED
  COMPLETED
  CANCELLED
}

model Admin {
  id           Int      @id @default(autoincrement())
  username     String   @unique @db.VarChar(40)
  passwordHash String   @map("password_hash")
  tokenVersion Int      @default(0) @map("token_version")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("admins")
}

model MenuItem {
  id             Int       @id @default(autoincrement())
  name           String    @db.VarChar(60)
  description    String?   @db.VarChar(200)
  price          Int
  imageUrl       String?   @map("image_url") @db.VarChar(500)
  isAvailable    Boolean   @default(true) @map("is_available")
  isActive       Boolean   @default(true) @map("is_active")
  sortOrder      Int       @default(0) @map("sort_order")
  dailyStock     Int       @default(0) @map("daily_stock")
  stockRemaining Int       @default(0) @map("stock_remaining")
  stockDate      DateTime? @map("stock_date") @db.Date
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  orderItems OrderItem[]

  @@index([isActive, isAvailable, sortOrder])
  @@map("menu_items")
}

model DeliveryLocation {
  id        Int      @id @default(autoincrement())
  name      String   @unique @db.VarChar(40)
  isActive  Boolean  @default(true) @map("is_active")
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  slots  DeliverySlot[]
  orders Order[]

  @@map("delivery_locations")
}

model DeliverySlot {
  id           Int       @id @default(autoincrement())
  locationId   Int       @map("location_id")
  deliveryTime String    @map("delivery_time") @db.Char(5)
  cutoffTime   String    @map("cutoff_time") @db.Char(5)
  isActive     Boolean   @default(true) @map("is_active")
  closedOn     DateTime? @map("closed_on") @db.Date
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  location DeliveryLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)
  orders   Order[]

  @@unique([locationId, deliveryTime])
  @@map("delivery_slots")
}

model DeliverySettings {
  id                   Int      @id @default(1)
  ordersPaused         Boolean  @default(false) @map("orders_paused")
  expressEnabled       Boolean  @default(true) @map("express_enabled")
  expressFee           Int      @default(30) @map("express_fee")
  expressEtaMinMinutes Int      @default(30) @map("express_eta_min_minutes")
  expressEtaMaxMinutes Int      @default(40) @map("express_eta_max_minutes")
  expressOpensAt       String   @default("11:00") @map("express_opens_at") @db.Char(5)
  expressClosesAt      String   @default("23:00") @map("express_closes_at") @db.Char(5)
  batchFee             Int      @default(0) @map("batch_fee")
  contactPhone         String?  @map("contact_phone") @db.Char(10)
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("delivery_settings")
}

model Order {
  id                   Int           @id @default(autoincrement())
  orderNumber          String        @unique @default(dbgenerated("('BB'::text || (nextval('order_number_seq'::regclass))::text)")) @map("order_number") @db.VarChar(20)
  clientRequestId      String        @unique @map("client_request_id") @db.Uuid
  customerName         String        @map("customer_name") @db.VarChar(60)
  customerPhone        String        @map("customer_phone") @db.Char(10)
  addressDetail        String?       @map("address_detail") @db.VarChar(120)
  deliveryMode         DeliveryMode  @map("delivery_mode")
  deliveryDate         DateTime      @map("delivery_date") @db.Date
  locationId           Int           @map("location_id")
  locationName         String        @map("location_name") @db.VarChar(40)
  slotId               Int?          @map("slot_id")
  slotDeliveryTime     String?       @map("slot_delivery_time") @db.Char(5)
  expressEtaMinMinutes Int?          @map("express_eta_min_minutes")
  expressEtaMaxMinutes Int?          @map("express_eta_max_minutes")
  foodSubtotal         Int           @map("food_subtotal")
  deliveryFee          Int           @map("delivery_fee")
  total                Int
  paymentMethod        PaymentMethod @default(COD) @map("payment_method")
  paymentStatus        PaymentStatus @default(PENDING) @map("payment_status")
  status               OrderStatus   @default(ORDER_RECEIVED)
  createdAt            DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)
  completedAt          DateTime?     @map("completed_at") @db.Timestamptz(3)
  cancelledAt          DateTime?     @map("cancelled_at") @db.Timestamptz(3)
  collectedAt          DateTime?     @map("collected_at") @db.Timestamptz(3)

  location DeliveryLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)
  slot     DeliverySlot?    @relation(fields: [slotId], references: [id], onDelete: Restrict)
  items    OrderItem[]

  @@index([deliveryDate, status])
  @@index([deliveryDate, slotId])
  @@index([customerPhone, deliveryDate])
  @@index([status, deliveryMode])
  @@map("orders")
}

model OrderItem {
  id         Int    @id @default(autoincrement())
  orderId    Int    @map("order_id")
  menuItemId Int    @map("menu_item_id")
  itemName   String @map("item_name") @db.VarChar(60)
  unitPrice  Int    @map("unit_price")
  quantity   Int
  lineTotal  Int    @map("line_total")

  order    Order    @relation(fields: [orderId], references: [id], onDelete: Restrict)
  menuItem MenuItem @relation(fields: [menuItemId], references: [id], onDelete: Restrict)

  @@unique([orderId, menuItemId])
  @@index([menuItemId])
  @@map("order_items")
}
```

The `orderNumber` default is written exactly as Postgres stores it, so the schema, the migration and `\d orders` all show the same expression.

**Prisma 7 specifics (as built in Batch 2).** Prisma 7.10.0; the generator options above worked unchanged. Database errors reach the code as `PrismaClientKnownRequestError`: a CHECK violation is code `P2039` for model calls and `P2010` for raw queries, with Postgres SQLSTATE `23514` and the constraint name inside `meta` (the constraint tests assert on those).

- `prisma.config.ts` at the repo root gives the CLI the schema path (`prisma/schema.prisma`), the migrations path (`prisma/migrations`) and `datasource.url` from `DATABASE_URL`. Prisma 7 doesn't read `.env` itself. The config calls `process.loadEnvFile('.env')` only when `DATABASE_URL` is unset and the file exists. A value already in the environment always wins, so the test and e2e harnesses can point the CLI at their own database, and production (no `.env`) uses the platform's variables. There is no `seed` entry; seeds run through our own scripts (Batch 2 §3.2).
- The client is generated as TypeScript into `src/server/generated/prisma` (git-ignored) and compiled with the server by `tsc`. `db.ts` creates it with the driver adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) })`.
- `prisma migrate dev` no longer runs `prisma generate` or the seed, so the scripts run `generate` explicitly (Batch 2 §3.2).

### 7.3 Hand-written migration SQL

Create the first migration with `prisma migrate dev --create-only --name init`, review the generated SQL, then add the following by hand. The sequence must be created **before** `CREATE TABLE "orders"`; everything else goes at the end.

```sql
-- Before CREATE TABLE "orders"
CREATE SEQUENCE order_number_seq START WITH 1001;

-- After all tables
ALTER SEQUENCE order_number_seq OWNED BY orders.order_number;

-- menu_items
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_price_positive      CHECK (price > 0),
  ADD CONSTRAINT menu_items_daily_stock_nonneg  CHECK (daily_stock >= 0),
  ADD CONSTRAINT menu_items_stock_nonneg        CHECK (stock_remaining >= 0),
  ADD CONSTRAINT menu_items_stock_le_daily      CHECK (stock_remaining <= daily_stock);

-- delivery_slots
ALTER TABLE delivery_slots
  ADD CONSTRAINT delivery_slots_delivery_fmt CHECK (delivery_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT delivery_slots_cutoff_fmt   CHECK (cutoff_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT delivery_slots_cutoff_first CHECK (cutoff_time COLLATE "C" < delivery_time COLLATE "C");

-- delivery_settings: exactly one row
ALTER TABLE delivery_settings
  ADD CONSTRAINT delivery_settings_singleton CHECK (id = 1),
  ADD CONSTRAINT delivery_settings_fees      CHECK (express_fee >= 0 AND batch_fee >= 0),
  ADD CONSTRAINT delivery_settings_eta       CHECK (express_eta_min_minutes >= 1
                                                    AND express_eta_min_minutes <= express_eta_max_minutes
                                                    AND express_eta_max_minutes <= 180),
  ADD CONSTRAINT delivery_settings_hours_fmt CHECK (express_opens_at  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                                                AND express_closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT delivery_settings_hours     CHECK (express_opens_at COLLATE "C" < express_closes_at COLLATE "C"),
  ADD CONSTRAINT delivery_settings_phone     CHECK (contact_phone IS NULL OR contact_phone ~ '^[6-9][0-9]{9}$');

INSERT INTO delivery_settings (id, updated_at) VALUES (1, now());

-- orders
ALTER TABLE orders
  ADD CONSTRAINT orders_phone_fmt      CHECK (customer_phone ~ '^[6-9][0-9]{9}$'),
  ADD CONSTRAINT orders_amounts        CHECK (food_subtotal > 0 AND delivery_fee >= 0),
  ADD CONSTRAINT orders_total          CHECK (total = food_subtotal + delivery_fee),
  ADD CONSTRAINT orders_mode_fields    CHECK (
    (delivery_mode = 'BATCH'   AND slot_id IS NOT NULL AND slot_delivery_time IS NOT NULL
                               AND express_eta_min_minutes IS NULL AND express_eta_max_minutes IS NULL)
    OR
    (delivery_mode = 'EXPRESS' AND slot_id IS NULL AND slot_delivery_time IS NULL
                               AND express_eta_min_minutes IS NOT NULL AND express_eta_max_minutes IS NOT NULL)
  ),
  ADD CONSTRAINT orders_cancel_unpaid  CHECK (NOT (status = 'CANCELLED' AND payment_status = 'COLLECTED'));

-- order_items
ALTER TABLE order_items
  ADD CONSTRAINT order_items_qty        CHECK (quantity >= 1),
  ADD CONSTRAINT order_items_price      CHECK (unit_price > 0),
  ADD CONSTRAINT order_items_line_total CHECK (line_total = unit_price * quantity);
```

The upper quantity limit (10) is enforced in zod, not in the database, so changing it doesn't need a migration.

Migration rules: never edit an applied migration; every later migration is also created with `--create-only` and reviewed; schema changes stay backward compatible with the previous deploy (add columns nullable or with defaults first, remove in a later deploy).

### 7.4 Initial data

| Data | Where | When |
|---|---|---|
| `delivery_settings` row (defaults in §7.2) | migration | always |
| Locations MSH, Kanhar; slots MSH 20:00 / cutoff 19:30, Kanhar 20:45 / cutoff 20:15, active (brief §5) | `prisma/seed-initial.ts` (idempotent upserts by name and `(location, time)`) | dev and production, once |
| Sample menu (Chicken Biryani ₹150, Paneer Biryani ₹130, Egg Biryani ₹120, Raita ₹20; prices are placeholders) with today's stock | `prisma/seed-dev.ts` (also runs seed-initial) | dev only; refuses to run when `NODE_ENV=production` |
| Admin account | `pnpm admin:create` (interactive) | dev and production; never seeded, never a default password |

### 7.5 Key SQL

All raw SQL uses Prisma tagged templates (`tx.$queryRaw\`…\``); `$queryRawUnsafe` and `$executeRawUnsafe` are forbidden.

**Reserve one line (S4)**, called per line in ascending `menuItemId`:

```sql
UPDATE menu_items
   SET stock_remaining = stock_remaining - ${qty},
       updated_at      = now()
 WHERE id = ${menuItemId}
   AND is_active
   AND is_available
   AND stock_date = ${today}::date
   AND stock_remaining >= ${qty}
RETURNING id, name, price, stock_remaining;
```

**Set today's stock (S3)** — one statement covers both paths. In a Postgres `UPDATE`, every right-hand expression sees the old row:

```sql
UPDATE menu_items
   SET daily_stock     = ${n},
       stock_remaining = CASE WHEN stock_date = ${today}::date
                              THEN ${n} - (daily_stock - stock_remaining)
                              ELSE ${n} END,
       stock_date      = ${today}::date,
       updated_at      = now()
 WHERE id = ${menuItemId}
   AND is_active
   AND (stock_date IS DISTINCT FROM ${today}::date
        OR ${n} >= daily_stock - stock_remaining)
RETURNING id, daily_stock, stock_remaining, stock_date;
```

Zero rows: re-read the item to tell `NOT_FOUND` (missing or deleted) from `STOCK_BELOW_SOLD` (include `sold` in details). The bulk endpoint runs this per item in ascending id inside one transaction, all or nothing.

**Restore for a cancelled order (S5)**, per line in ascending `menuItemId`, after the order row is locked:

```sql
UPDATE menu_items
   SET stock_remaining = stock_remaining + ${qty},
       updated_at      = now()
 WHERE id = ${menuItemId}
   AND stock_date = ${orderDeliveryDate}::date;
```

Zero rows is fine: the item's stock now belongs to another day, so nothing is restored.

**Lock order:** the order row first (`SELECT id, status, payment_status, delivery_date FROM orders WHERE id = ${id} FOR UPDATE`), then menu items in ascending id. Order creation locks menu items in ascending id and has no order row yet. With one global lock order, cancels and concurrent orders cannot deadlock.

**Inventory invariant (S8)** — must return zero rows:

```sql
SELECT m.id, m.daily_stock, m.stock_remaining, COALESCE(s.qty, 0) AS sold_by_orders
  FROM menu_items m
  LEFT JOIN (
        SELECT oi.menu_item_id, o.delivery_date, SUM(oi.quantity)::int AS qty
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
         WHERE o.status <> 'CANCELLED'
         GROUP BY oi.menu_item_id, o.delivery_date
       ) s ON s.menu_item_id = m.id AND s.delivery_date = m.stock_date
 WHERE m.stock_remaining < 0
    OR m.stock_remaining > m.daily_stock
    OR (m.stock_date IS NOT NULL
        AND m.daily_stock - m.stock_remaining <> COALESCE(s.qty, 0));
```

Test factories that create menu items must set `stock_remaining = daily_stock` (nothing sold) so the invariant holds.

---

## 8. API

### 8.1 Conventions

- Base path `/api`. JSON in and out. Request bodies are capped at 10 KB.
- **Success** returns the resource object directly (no envelope). **Errors** always return:
  ```json
  { "error": { "code": "OUT_OF_STOCK", "message": "Only 2 Chicken Biryani left.", "details": { … } } }
  ```
  `message` is safe to show to a customer. `details` is machine-readable and documented per code.
- Validation errors: `400 VALIDATION_ERROR` with `details.fieldErrors` (`{ "customerPhone": ["Enter a 10-digit mobile number"] }`) from the zod issues.
- Dates are `"YYYY-MM-DD"` (IST business dates). Times of day are `"HH:mm"` (IST). Instants are ISO 8601 UTC strings. Money is integer rupees.
- Every `/api` response sends `Cache-Control: no-store`.
- Path ids are positive integers no larger than 2147483647 (Postgres `int`); anything else is `404 NOT_FOUND`, so a huge id never reaches the database and fails as a `500`.
- Unknown `/api/*` routes return `404 NOT_FOUND` as JSON, never `index.html`.
- Admin routes need the `bbc_admin` cookie (§9.1). Admin writes (`POST`, `PATCH`, `PUT`, `DELETE`) and the login request also pass the Origin check (§9.2).

### 8.2 Error codes

| Code | HTTP | When | `details` |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | body or query fails the zod schema; slot does not belong to the location (path ids: see §8.1) | `fieldErrors` |
| `UNAUTHENTICATED` | 401 | missing, invalid or expired admin session | — |
| `INVALID_CREDENTIALS` | 401 | login failed (same response for unknown user and wrong password) | — |
| `FORBIDDEN_ORIGIN` | 403 | admin write with a missing or foreign `Origin` | — |
| `NOT_FOUND` | 404 | unknown route or resource | — |
| `ORDER_NOT_FOUND` | 404 | lookup: unknown order **or** phone mismatch, identical body for both | — |
| `ORDERS_PAUSED` | 409 | `ordersPaused` | — |
| `SLOT_CLOSED` | 409 | batch slot not open | `reason`: `CUTOFF_PASSED` / `CLOSED_TODAY` / `INACTIVE`; `expressAvailable` |
| `LOCATION_UNAVAILABLE` | 409 | location inactive | — |
| `EXPRESS_UNAVAILABLE` | 409 | express off or outside hours | `reason`: `DISABLED` / `OUTSIDE_HOURS` |
| `ITEM_UNAVAILABLE` | 409 | item unknown, deleted or disabled | `items: [{ menuItemId }]` |
| `OUT_OF_STOCK` | 409 | not enough stock today | `items: [{ menuItemId, name, available }]` |
| `PRICE_CHANGED` | 409 | server total ≠ `expectedTotal` | `total` |
| `IDEMPOTENCY_CONFLICT` | 409 | `clientRequestId` reused with a different phone | — |
| `INVALID_TRANSITION` | 409 | status or payment change not allowed (§6.9) | `from`, `to` |
| `STOCK_BELOW_SOLD` | 409 | new stock lower than already sold today | `items: [{ menuItemId, sold }]` |
| `DUPLICATE` | 409 | unique conflict (location name, slot time) | `field` |
| `TOO_MANY_OPEN_ORDERS` | 429 | per-phone open-order cap | `limit` |
| `RATE_LIMITED` | 429 | IP rate limit; `Retry-After` header set | — |
| `INTERNAL_ERROR` | 500 | anything unexpected; logged with a request id, no internals in the response | `requestId` |

### 8.3 Endpoint index

| Method | Path | Auth | Built in |
|---|---|---|---|
| GET | `/api/health` | public | Batch 2 |
| GET | `/api/menu` | public | Batch 3 |
| GET | `/api/delivery-options` | public | Batch 4 |
| POST | `/api/orders` | public, rate-limited | Batch 5 |
| POST | `/api/orders/lookup` | public, rate-limited | Batch 5 |
| POST | `/api/admin/login` | public, rate-limited, Origin | Batch 2 |
| POST | `/api/admin/logout` | admin | Batch 2 |
| GET | `/api/admin/me` | admin | Batch 2 |
| GET | `/api/admin/dashboard` | admin | Batch 6 |
| GET | `/api/admin/orders` | admin | Batch 6 |
| GET | `/api/admin/orders/:id` | admin | Batch 6 |
| PATCH | `/api/admin/orders/:id/status` | admin | Batch 6 |
| POST | `/api/admin/orders/complete-many` | admin | Batch 6 |
| GET / POST | `/api/admin/menu` | admin | Batch 6 |
| PATCH / DELETE | `/api/admin/menu/:id` | admin | Batch 6 |
| PUT | `/api/admin/stock` | admin | Batch 6 |
| GET / POST | `/api/admin/locations` | admin | Batch 6 |
| PATCH | `/api/admin/locations/:id` | admin | Batch 6 |
| GET / POST | `/api/admin/delivery-slots` | admin | Batch 6 |
| PATCH | `/api/admin/delivery-slots/:id` | admin | Batch 6 |
| GET / PATCH | `/api/admin/settings` | admin | Batch 6 |

Additions to the brief's list: `/api/admin/me` (the SPA's route guard needs it), locations CRUD (brief §19 asks for location config but §21 had no route), `PUT /api/admin/stock` (one save for the morning setup), `POST /api/admin/orders/complete-many` (one tap per batch instead of one per order). Change: order lookup is `POST /api/orders/lookup` instead of `GET /api/orders/:orderNumber?phone=` (D5).

### 8.4 Public endpoints

#### `GET /api/health`

`200 { "status": "ok" }` after `SELECT 1` succeeds; `503 { "status": "error" }` otherwise. Used by the platform health check and uptime monitor.

#### `GET /api/menu`

```json
{
  "businessDate": "2026-10-04",
  "ordersPaused": false,
  "items": [
    {
      "id": 3,
      "name": "Chicken Biryani",
      "description": "Full plate with raita",
      "price": 150,
      "imageUrl": null,
      "soldOut": false,
      "maxQty": 10,
      "onlyLeft": null
    },
    {
      "id": 5,
      "name": "Mutton Biryani",
      "description": null,
      "price": 220,
      "imageUrl": "https://…",
      "soldOut": false,
      "maxQty": 3,
      "onlyLeft": 3
    }
  ]
}
```

Items are those in MN1, orderable first, then sold out (MN2). `maxQty = soldOut ? 0 : min(stockRemaining, MAX_QTY_PER_ITEM)`. `onlyLeft = !soldOut && stockRemaining ≤ 5 ? stockRemaining : null`, so leftover stock from another day never shows as "only N left". The response never includes `dailyStock` or sales figures.

#### `GET /api/delivery-options`

```json
{
  "businessDate": "2026-10-04",
  "serverTime": "19:10",
  "ordersPaused": false,
  "contactPhone": "9876543210",
  "batch": {
    "fee": 0,
    "slots": [
      { "id": 1, "locationId": 1, "locationName": "MSH", "deliveryTime": "20:00", "cutoffTime": "19:30",
        "isOpen": true, "closedReason": null },
      { "id": 2, "locationId": 2, "locationName": "Kanhar", "deliveryTime": "20:45", "cutoffTime": "20:15",
        "isOpen": true, "closedReason": null }
    ]
  },
  "express": {
    "available": true,
    "unavailableReason": null,
    "fee": 30,
    "etaMinMinutes": 30,
    "etaMaxMinutes": 40,
    "etaText": "30–40 minutes",
    "opensAt": "11:00",
    "closesAt": "23:00",
    "locations": [ { "id": 1, "name": "MSH" }, { "id": 2, "name": "Kanhar" } ]
  }
}
```

- Slots: active slots at active locations, sorted by `deliveryTime`, then location `sortOrder`, then slot `id` **(as built, Batch 4: the `id` tie-break keeps the order stable when two slots share a time and sort order)**. `isOpen` per B3, ignoring `ordersPaused` (the top-level flag covers that). `closedReason`: `CUTOFF_PASSED` or `CLOSED_TODAY`.
- `express.available` per E1 ignoring `ordersPaused`; `unavailableReason`: `DISABLED` or `OUTSIDE_HOURS`.
- `express.locations`: active locations by `sortOrder`, then `id` **(as built, Batch 4)**.

#### `POST /api/orders`

Request (`createOrderSchema`, a discriminated union on `deliveryMode`):

```json
{
  "clientRequestId": "6f1c2a7e-4b8d-4c1e-9a3f-2d5e8b7c9a10",
  "customerName": "Rahul Verma",
  "customerPhone": "+91 98765 43210",
  "addressDetail": "Room 214, B block",
  "deliveryMode": "BATCH",
  "locationId": 1,
  "slotId": 1,
  "items": [ { "menuItemId": 3, "quantity": 2 }, { "menuItemId": 7, "quantity": 1 } ],
  "expectedTotal": 320
}
```

- `customerName`: trimmed, inner whitespace collapsed, `NAME_MIN`–`NAME_MAX`.
- `customerPhone`: normalised by `normalizeIndianMobile` (§6.11).
- `addressDetail`: optional; trimmed; empty string becomes `null`; ≤ `ADDRESS_MAX`.
- `deliveryMode: "EXPRESS"` takes `locationId` only; a `slotId` key is rejected (`.strict()`).
- `items`: 1–`MAX_LINES_PER_ORDER` lines, `quantity` integer 1–`MAX_QTY_PER_ITEM`. Duplicates are merged server-side (§6.12 step 3).
- `expectedTotal`: integer ≥ 0.

Responses: `201` new order, `200` idempotent replay; body is the **public order view**:

```json
{
  "orderNumber": "BB1023",
  "replayed": false,
  "status": "ORDER_RECEIVED",
  "paymentMethod": "COD",
  "paymentStatus": "PENDING",
  "deliveryMode": "EXPRESS",
  "deliveryDate": "2026-10-04",
  "locationName": "Kanhar",
  "slotDeliveryTime": null,
  "expressWindow": { "from": "19:40", "to": "19:50", "etaText": "30–40 minutes" },
  "customerName": "Rahul Verma",
  "addressDetail": "Room 214, B block",
  "items": [ { "name": "Chicken Biryani", "unitPrice": 150, "quantity": 2, "lineTotal": 300 } ],
  "foodSubtotal": 300,
  "deliveryFee": 30,
  "total": 330,
  "createdAt": "2026-10-04T13:40:12.000Z",
  "contactPhone": "9876543210"
}
```

Errors: `VALIDATION_ERROR`, `ORDERS_PAUSED`, `SLOT_CLOSED`, `LOCATION_UNAVAILABLE`, `EXPRESS_UNAVAILABLE`, `ITEM_UNAVAILABLE`, `OUT_OF_STOCK`, `PRICE_CHANGED`, `IDEMPOTENCY_CONFLICT`, `TOO_MANY_OPEN_ORDERS`, `RATE_LIMITED`.

#### `POST /api/orders/lookup`

Request `{ "orderNumber": "bb1023", "phone": "98765 43210" }`; `orderNumber` is trimmed and upper-cased; phone is normalised. `200` returns the public order view (without `replayed`). Unknown order or wrong phone both return `404 ORDER_NOT_FOUND` with the same body, never `403` (brief §21).

### 8.5 Admin endpoints

#### Auth

- `POST /api/admin/login` — `{ username, password }` → `200 { "username": "bunty" }` and `Set-Cookie: bbc_admin=…`. Errors: `INVALID_CREDENTIALS`, `RATE_LIMITED`, `FORBIDDEN_ORIGIN`.
- `POST /api/admin/logout` — `204`, clears the cookie.
- `GET /api/admin/me` — `200 { "username": "bunty" }` or `401`.

#### Admin order view

Used by the dashboard, list and detail:

```json
{
  "id": 57,
  "orderNumber": "BB1023",
  "status": "ORDER_RECEIVED",
  "paymentMethod": "COD",
  "paymentStatus": "PENDING",
  "deliveryMode": "BATCH",
  "deliveryDate": "2026-10-04",
  "locationId": 1,
  "locationName": "MSH",
  "slotId": 1,
  "slotDeliveryTime": "20:00",
  "expressWindow": null,
  "isLate": false,
  "customerName": "Rahul Verma",
  "customerPhone": "9876543210",
  "addressDetail": "Room 214, B block",
  "items": [ { "menuItemId": 3, "name": "Chicken Biryani", "unitPrice": 150, "quantity": 2, "lineTotal": 300 } ],
  "itemCount": 2,
  "foodSubtotal": 300,
  "deliveryFee": 0,
  "total": 300,
  "createdAt": "2026-10-04T08:30:12.000Z",
  "completedAt": null,
  "cancelledAt": null,
  "collectedAt": null
}
```

#### `GET /api/admin/dashboard?date=YYYY-MM-DD`

`date` defaults to today.

```json
{
  "date": "2026-10-04",
  "isToday": true,
  "serverTime": "19:12",
  "controls": { "ordersPaused": false, "expressEnabled": true, "expressAvailableNow": true, "expressOpensAt": "18:00", "expressClosesAt": "23:00" },
  "stock": { "itemsOnMenu": 6, "itemsWithoutStockToday": 2 },
  "summary": {
    "newOrders": 7,
    "completed": 3,
    "cancelled": 1,
    "codPending": 2240,
    "codCollected": 600,
    "openOrdersFromEarlierDays": 0
  },
  "batches": [
    {
      "slotId": 1,
      "locationName": "MSH",
      "deliveryTime": "20:00",
      "cutoffTime": "19:30",
      "slotTimeChanged": false,
      "isOpenNow": true,
      "closedToday": false,
      "orderCount": 4,
      "openCount": 3,
      "itemCount": 9,
      "codTotal": 1340,
      "codPending": 1040,
      "itemBreakdown": [ { "menuItemId": 3, "name": "Chicken Biryani", "quantity": 8 },
                         { "menuItemId": 4, "name": "Paneer Biryani", "quantity": 1 } ],
      "orders": [ "…admin order view…" ]
    }
  ],
  "express": {
    "activeCount": 2,
    "orders": [ "…admin order view…" ]
  },
  "earlierOpenOrders": [ "…admin order view…" ]
}
```

Rules (built in Batch 6):

- Counts and totals exclude cancelled orders (L3). `newOrders` = today's `ORDER_RECEIVED` orders, both modes.
- A batch group is `(slotId, slotDeliveryTime)` for the date. For today, every active slot appears even with zero orders. A group whose slot time was changed mid-day appears separately, labelled with the snapshotted time and `slotTimeChanged: true`.
- `orderCount` counts non-cancelled orders; `itemCount` sums quantities; `codTotal` sums totals; `codPending` sums totals with `paymentStatus = PENDING`; `itemBreakdown` is sorted by quantity, largest first.
- Group orders are sorted open first, then by `createdAt`. Cancelled orders are listed last, greyed out, and not counted.
- `express.orders`: active express orders (any date, oldest first, so a late-night order is never lost), then this date's completed and cancelled express orders.
- `openOrdersFromEarlierDays` / `earlierOpenOrders`: `ORDER_RECEIVED` batch orders with `deliveryDate < today` (express ones are already in `express.orders`), oldest first. Only filled when viewing today. Usually empty; it exists so nothing is forgotten.
- `stock.itemsWithoutStockToday`: active + available items whose `stockDate ≠ today`. The UI shows a warning banner when it is above 0.

#### `GET /api/admin/orders?date=&mode=&status=&slotId=&q=`

`date` defaults to today. `q` matches an order number (`BB1023`, `1023`) or a phone number (exact or last 4+ digits) and ignores `date` when present. Returns `{ "orders": [admin order view] }`, newest first, capped at 500.

#### `GET /api/admin/orders/:id`

Admin order view or `404`.

#### `PATCH /api/admin/orders/:id/status`

Body: exactly one of `{ "status": "COMPLETED" | "ORDER_RECEIVED" | "CANCELLED" }` or `{ "paymentStatus": "COLLECTED" | "PENDING" }`. Returns the updated admin order view. Errors: `INVALID_TRANSITION`, `NOT_FOUND`.

#### `POST /api/admin/orders/complete-many`

Body `{ "orderIds": [57, 58, 61], "markCollected": true }` (1–200 ids). Completes each listed order (and marks cash collected if asked) through the status machine, in ascending id order, in one transaction: all or nothing. Already-completed or already-collected orders are no-ops. A cancelled order in the list → `409 INVALID_TRANSITION`; an unknown id → `404`. Returns `{ "completed": 3, "collected": 3 }`.

The client sends the ids of the open orders it is showing, never "everything in the group": an order placed after the vendor packed the batch must not be marked completed by accident.

#### Menu

- `GET /api/admin/menu` → `{ "items": [admin menu item] }`, active items only, by `sortOrder`.
  ```json
  { "id": 3, "name": "Chicken Biryani", "description": "…", "price": 150, "imageUrl": null,
    "isAvailable": true, "sortOrder": 0,
    "dailyStock": 30, "stockRemaining": 8, "stockDate": "2026-10-04",
    "stockSetToday": true, "soldToday": 22 }
  ```
- `POST /api/admin/menu` — `{ name, description?, price, imageUrl?, isAvailable?, sortOrder? }` → `201` admin menu item. New items start with no stock (`stockDate = null`).
- `PATCH /api/admin/menu/:id` — any subset of the create fields. Stock is not editable here. Price changes affect new orders only (snapshots).
- `DELETE /api/admin/menu/:id` — `204`; sets `isActive = false`. Past orders are unaffected.
- `imageUrl` must be an `https://` URL.

#### `PUT /api/admin/stock`

Body `{ "items": [ { "menuItemId": 3, "stock": 30 }, … ] }`, 1–100 entries, `stock` integer 0–10000. Applies S3 to every entry in one transaction (all or nothing). Returns `{ "items": [admin menu item] }`. Errors: `STOCK_BELOW_SOLD` (lists every offending item), `NOT_FOUND`.

#### Locations

- `GET /api/admin/locations` → `{ "locations": [ { id, name, isActive, sortOrder, slotCount } ] }`.
- `POST /api/admin/locations` — `{ name, sortOrder? }` → `201`. Duplicate name → `409 DUPLICATE`.
- `PATCH /api/admin/locations/:id` — `{ name?, isActive?, sortOrder? }`. Renaming changes what new orders snapshot; old orders keep their name.

#### Delivery slots

- `GET /api/admin/delivery-slots` → `{ "slots": [ { id, locationId, locationName, deliveryTime, cutoffTime, isActive, closedToday, openOrdersToday } ] }`.
- `POST /api/admin/delivery-slots` — `{ locationId, deliveryTime, cutoffTime, isActive? }` → `201`. `cutoffTime >= deliveryTime` → `400`; duplicate `(locationId, deliveryTime)` → `409 DUPLICATE`.
- `PATCH /api/admin/delivery-slots/:id` — `{ deliveryTime?, cutoffTime?, isActive?, closedToday? }`. `closedToday: true` sets `closedOn = today`; `false` clears it. The cutoff rule is checked against the merged result.

#### Settings

- `GET /api/admin/settings` → all `DeliverySettings` fields except `id` and `updatedAt`.
- `PATCH /api/admin/settings` — any subset of `ordersPaused`, `expressEnabled`, `expressFee` (0–500), `batchFee` (0–500), `expressEtaMinMinutes`, `expressEtaMaxMinutes` (1–180, min ≤ max on the merged result), `expressOpensAt`, `expressClosesAt` (opens < closes on the merged result), `contactPhone` (Indian mobile or `null`).

---

## 9. Security

### 9.1 Admin authentication (brief §22)

- One admin account, created by `pnpm admin:create`. Password at least 10 characters, hashed with **argon2id** (library defaults or stronger).
- Login compares with `argon2.verify`. For an unknown username it still verifies against a fixed dummy hash, so response time doesn't reveal which usernames exist. Both failures return `401 INVALID_CREDENTIALS` with the message "Wrong username or password."
- Session = HS256 JWT signed with `JWT_SECRET` (at least 32 characters, checked at boot; generate 48 random bytes as shown in §11), claims `{ sub: adminId, tv: tokenVersion, iat, exp }`, valid for **14 days**.
- Cookie `bbc_admin`: `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age` = token lifetime.
- `requireAdmin` verifies the JWT, loads the admin by `sub` and rejects if missing or `tokenVersion ≠ tv`. `admin-reset-password` bumps `tokenVersion`, logging out every device (D9).
- Logout clears the cookie. A stolen token stays valid until expiry unless the password is reset; that is accepted for Phase 1.
- Frontend route guards are UX only. Every `/api/admin/*` route except login is behind `requireAdmin`.

### 9.2 CSRF

- `SameSite=Lax` stops browsers sending the cookie on cross-site `POST`/`PATCH`/`PUT`/`DELETE`.
- **Origin check** (defence in depth): admin writes and login must carry an `Origin` header equal to `APP_ORIGIN` (in development also `http://localhost:5173` and any `DEV_ALLOWED_ORIGINS`). Missing or different → `403 FORBIDDEN_ORIGIN`.
- The API only accepts `application/json` bodies, which a cross-site HTML form cannot send.
- Admin endpoints never change state on `GET`.

### 9.3 Public endpoints

- No cookies are read or set on public routes.
- `POST /api/orders` doesn't need CSRF protection (no ambient credentials); it is protected by rate limits, the per-phone cap and validation.
- Lookup requires the exact phone and returns an identical `404` for "no such order" and "wrong phone".

### 9.4 Rate limiting

`express-rate-limit` with the in-memory store (one instance). Limits are in §6.11. Exceeding one returns `429 RATE_LIMITED` with `Retry-After`. `app.set('trust proxy', 1)` in production so the client IP comes from the platform proxy's `X-Forwarded-For`. Without it every request looks like it comes from one IP.

### 9.5 Headers and transport

- `helmet` with CSP: `default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
- HTTPS is terminated by the platform; HSTS via helmet in production.
- `x-powered-by` disabled.

### 9.6 Secrets and personal data

- Secrets (`DATABASE_URL`, `JWT_SECRET`) live in environment variables validated at boot (§11). Nothing secret is bundled into the frontend or committed. `.env` is git-ignored; `.env.example` holds placeholders.
- Logs never contain request bodies, phone numbers, passwords or cookies. Request logs record method, path (without query string), status, duration and a request id.
- Customer phone numbers appear only in admin responses and the customer's own lookup.

### 9.7 SQL

Prisma client queries or tagged-template raw SQL only. No string-built SQL, no `$queryRawUnsafe`.

---

## 10. Frontend architecture

### 10.1 Routes

| Path | Screen | Batch |
|---|---|---|
| `/` | Today's menu + sticky cart bar | 3 |
| `/checkout` | Your order, delivery method, where & when, your details, summary, Place order | 4 (UI), 5 (submit) |
| `/order/:orderNumber` | Confirmation / order status | 5 |
| `/track` | Look up an order (order ID + phone) and recent orders on this phone | 5 |
| `/admin/login` | Vendor login | 2 |
| `/admin` | Today: emergency controls, batch groups, express | 6 |
| `/admin/orders` | Search and list | 6 |
| `/admin/orders/:id` | Order detail + actions | 6 |
| `/admin/stock` | Today's stock | 6 |
| `/admin/menu` | Menu items | 6 |
| `/admin/menu/new` | Add menu item | 6 |
| `/admin/menu/:id` | Edit menu item | 6 |
| `/admin/delivery` | Locations, slots, express, fees, pause | 6 |
| `*` | Not found | 2 |

The brief's separate CART step is the "Your order" section at the top of `/checkout`, where quantities stay editable. One page fewer keeps the order under a minute.

### 10.2 State and data

- **Server data:** SWR with a thin `api.ts` wrapper that throws `ApiError { status, code, message, details }`. No global-state library.
- **Cart:** React context + `useReducer`, persisted to `localStorage` (`bbc.cart.v1`) as `{ businessDate, lines: [{ menuItemId, quantity, name }] }`. **(as built, Batch 3)** `name` is kept only so a notice can name an item that has vanished from the menu ("Raita is no longer available…"); it is never shown as the item's name in the cart and never a price. Prices and live names always come from the latest menu.
- **Remembered customer details:** `bbc.customer.v1` `{ customerName, customerPhone, addressDetail, deliveryMode, locationId }` (**(as built, Batch 4)** the field names match `createOrderSchema`; the last delivery mode and location are remembered, not the slot), so a repeat order is a few taps. A "Not you? Clear details" link removes them. Batch 5 writes it after a successful order; Batch 4 only reads it.
- **Recent orders:** `bbc.orders.v1`, the last 10 `{ orderNumber, phone, deliveryDate }`, so `/track` and `/order/:orderNumber` work without retyping.
- Every storage read is wrapped in try/catch and validated with zod; bad or missing data falls back to empty.

### 10.3 Design system

Fonts are defined in Batch 2 §8.3 and tokens (from the logo) in Batch 2 §9. Summary:

- Brand red for primary actions; flat gold accents (never gradients, never text); espresso-brown text; sun-yellow and cream backgrounds.
- Archivo for display (uppercase headings, brand name, order ID); Inter for UI text and all prices.
- Error states always use `--color-danger` + an icon + the soft danger background, because brand red is not an error colour.
- Use the tokens in components, never raw hex values.
- Brand name in UI copy: **"Bunty Biryani Centre"** (spelled as on the logo, although the brief says "Center").

### 10.4 Every screen has

A loading state (skeleton, not a spinner, for lists), an empty state, an error state with a retry action, and the paused / unavailable banners where they apply. All copy lives in `src/client/copy.ts` so the owner can review it in one place (Batch 7).

### 10.5 Budgets (verified in Batch 7)

- Customer first-load JS (route `/`) ≤ **130 KB gzipped**; the admin chunk is lazy-loaded and excluded.
- Lighthouse mobile: Performance ≥ 90, Accessibility ≥ 95.
- Designed at **360 px** wide; no horizontal scroll from 320 px up.
- Tap targets ≥ 48 px high; form inputs at 16 px font so iOS doesn't zoom.

---

## 11. Configuration

Validated by `src/server/config.ts` (zod) at boot; the process exits with a readable message if anything is wrong.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | — | `development`, `test` or `production` |
| `DATABASE_URL` | yes | — | Postgres connection string |
| `DATABASE_URL_TEST` | tests | — | separate database; tests refuse to run against `DATABASE_URL` |
| `JWT_SECRET` | yes | — | ≥ 32 characters; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `APP_ORIGIN` | production | `http://localhost:3000` | exact public origin, e.g. `https://bbc.onrender.com`; used by the Origin check |
| `PORT` | no | `3000` | platforms set it |
| `TRUST_PROXY` | no | `1` in production, `0` otherwise | hops to trust for `X-Forwarded-For` |
| `CLOCK_OVERRIDE` | no | — | ISO instant; only honoured when `NODE_ENV=test`; boot fails if set in production |
| `DEV_ALLOWED_ORIGINS` | no | — | comma-separated extra origins for the Origin check (e.g. testing on a phone over the LAN); ignored outside development |

---

## 12. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | `src/shared` (phone, time, pricing, schemas), status machine table, cart reducer, delivery-option rules with a fixed clock |
| Integration | Vitest + supertest + real Postgres | every endpoint; transactions; concurrency; constraints. `createApp()` with a test clock. Runs serially (shared DB) |
| E2E | Playwright, mobile viewport 360×740, `NODE_ENV=test` with `CLOCK_OVERRIDE` | customer and vendor journeys (Batch 7) |
| Manual | Real Android phone (Chrome), iPhone (Safari) if available | brief §29 "Mobile" list, Batch 7 |

Rules:

- Each batch ships tests for its own behaviour; Batch 7 fills gaps and adds e2e.
- Integration tests reset the test database before each test (truncate + restart sequences + reset settings row) and run the inventory invariant (§7.5) after each test that touches stock or orders. It must return zero rows.
- The concurrency tests must stay green: the last item; ten buyers for five items; opposite-order carts; the same `clientRequestId` sent concurrently, including for the last item (§6.12 step 14); concurrent double cancel (Batch 5 §12, Batch 6 §9).
- "It works" means the relevant tests were run and passed.

---

## 13. Brief → batch map

| Brief § | Topic | Where it is specified / built |
|---|---|---|
| 1 | Product understanding | B1 §1 |
| 2 | Phase 1 goal | B1 §2; customer B3–B5; vendor B6 |
| 3 | Payment model (COD) | B1 §6.10; customer copy B4–B5; admin B6 |
| 4 | Delivery method UI | B4 |
| 5 | Batch delivery slots | B1 §6.5, §7; seed B2; customer B4; admin B6 |
| 6 | Batch order flow (never merge) | B1 B8; orders B5; grouping B6 |
| 7 | Express delivery | B1 §6.6; customer B4; orders B5; admin B6 |
| 8 | Delivery fees | B1 §6.7; display B4; server B5; admin B6 |
| 9 | Express availability | B1 E1; customer B4; toggle B6 |
| 10 | Batch cutoff | B1 §6.2, B3; customer B4; enforced B5 |
| 11 | Emergency controls | B1 §6.8; customer B3–B4; enforced B5; toggles B6 |
| 12 | Customer flow | B3 → B4 → B5 |
| 13 | Customer menu | B3 |
| 14 | Inventory | B1 §6.4, §7.5; service B5; vendor stock screen B6 |
| 15 | Order data | B1 §7.2; B5 |
| 16 | Order status | B1 §6.9; B6 |
| 17 | Vendor dashboard | B6 |
| 18 | Admin menu management | B6 |
| 19 | Delivery configuration | B6 |
| 20 | Database | B1 §7; B2 |
| 21 | API | B1 §8; implemented B2–B6 |
| 22 | Authentication | B1 §9.1; B2 |
| 23 | Technology and deployment | B1 §3–§5; B2; B8 |
| 24 | Mobile-first design | B1 §10; tokens B2; screens B3–B6; polish B7 |
| 25 | Order creation (server) | B1 §6.12; B5 |
| 26 | Abuse protection | B1 §6.11; login limits B2; order limits B5 |
| 27 | Bulk / catering | B1 §1.1 (glossary only) |
| 28 | Phase 1 exclusions | B1 §2.2 |
| 29 | Testing checklist | each batch's tests; consolidated in B7 |
| 30 | Definition of done | B7 (verified locally), B8 (verified in production) |
| 31 | Development process | `CLAUDE.md`; every batch spec ends with tests, DoD and commands |
| 32 | Engineering principle | `CLAUDE.md`; §14 below |

---

## 14. Decisions (deliberate changes to the brief)

| # | Brief | This spec | Why |
|---|---|---|---|
| D1 | §14 stock has no date; no daily reset | `stockDate`: stock counts only on the date it was set; otherwise the item shows sold out | Without it, yesterday's leftovers are sellable the next morning before the vendor has set up the day. Failing safe (sold out) beats taking orders that won't be cooked. Still no midnight job. |
| D2 | §14 cancel restores stock | Restore only when the order's date equals the item's `stockDate` | Cancelling an old order must not add phantom stock to today. |
| D3 | §5 "toggle a slot off for the day" | Two controls: `closedOn` (closed today only, reopens tomorrow automatically) and `isActive` (off until turned on) | Matches the brief's wording and stops a one-off closure from silently killing tomorrow's orders. |
| D4 | §7 express "any time" | Express hours (`expressOpensAt`–`expressClosesAt`, default 11:00–23:00, editable) | Stops 2 AM COD orders when the express switch was left on. Defaults are a guess (see Q1). |
| D5 | §21 `GET /api/orders/:orderNumber?phone=` | `POST /api/orders/lookup` with the phone in the body | Keeps phone numbers out of URLs, browser history and platform access logs. Same 404 behaviour. |
| D6 | — | `expectedTotal` on order creation; mismatch → `409 PRICE_CHANGED` | With COD, a silent price change means an argument at the door. The customer confirms the new total instead. |
| D7 | §26 per-phone rate limit | Cap on open orders per phone per day (3), counted in the database; IP limit kept but generous | Hostel Wi-Fi puts many students behind one IP; an open-orders cap targets pranks without blocking real customers and survives restarts. |
| D8 | §21 endpoint list | Added `/api/admin/me`, locations CRUD, `PUT /api/admin/stock`, `POST /api/admin/orders/complete-many` | Needed for the route guard, §19 location config, a 30-second morning stock setup and one-tap batch completion. |
| D9 | §22 JWT cookie | JWT carries `tokenVersion`; password reset logs out every device | Gives a way to revoke a lost phone's session without a sessions table. |
| D10 | §13 optional image | `imageUrl` (https link) only; no uploads | Render/Railway disks are wiped on deploy; uploads would need object storage. The menu works well without images. |
| D11 | §16 three statuses | Same statuses; adds "Reopen" (COMPLETED → ORDER_RECEIVED) and "Undo cash collected"; cancel only while cash is pending | One-handed phone use means mis-taps. Every vendor action except cancel is reversible; cancel asks for confirmation. |
| D12 | §15 `deliveryDate` | Orders are always for today's business date | Pre-orders for future days aren't in the brief and would complicate stock. |
| D13 | §23 Render/Railway | Paid starter tiers, Singapore region | Free web services sleep (a 30–60 s first load loses orders) and free Postgres databases expire. See Batch 8. |
| D14 | §7 window shown to vendor | ETA minutes snapshotted on the order | The vendor's window for an order doesn't move if settings change later. |
| D15 | §15 order number from 1001 | Gaps allowed | A Postgres sequence isn't transactional; gap-free numbering would need a locked counter for no benefit. |
| D16 | §23 React + Vite (stack) | Single package, no workspaces; shared code in `src/shared` | Shares zod schemas between both sides without monorepo tooling. |
| D17 | §12 CART step | Cart review lives at the top of `/checkout` | One page fewer between menu and order. |
| D18 | §17 express list | Active express orders from earlier dates stay on the dashboard; "open orders from earlier days" counter | A late order must not vanish from the dashboard at midnight. |
| D19 | §25 pause check first, then idempotency | Idempotency check first, before the transaction and the pause check (§6.12 step 1); rejected requests re-check it (step 14) | A customer retrying after a network drop must get the order that was actually placed, never "paused", "sold out" or "too many orders" for it. |

---

## 15. Open questions for the owner

Phase 1 is built with the defaults below until the owner answers.

| # | Question | Default used |
|---|---|---|
| Q1 | Express delivery hours? | 11:00–23:00 IST, editable in settings |
| Q2 | Maximum open orders per phone per day? | 3 |
| Q3 | Which phone number should customers see for help (confirmation and lookup pages)? | None shown until set in settings |
| Q4 | Item photos: do you have them, and where are they hosted? | No images; text menu |
| Q5 | Hosting: Render or Railway, and the monthly budget? | Render, paid starter web service + paid Postgres, Singapore |
| Q6 | Domain name? | Platform subdomain until one is bought |
| Q7 | How should the vendor hear about new express orders when the dashboard isn't open? | Dashboard polls every 20 s with an optional sound; push notifications are Phase 2 |
| Q8 | How long should customer phone numbers be kept? | Indefinitely in Phase 1 |
| Q9 | Real menu items and prices? | Seed placeholders (dev only) |
| Q10 | Can customers cancel their own orders? | No; they contact the vendor, who cancels |
