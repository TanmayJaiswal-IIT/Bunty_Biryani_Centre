# Batch 5 — Order creation + inventory

| | |
|---|---|
| Status | Built 2026-10-07: lint, typecheck, build and all 442 tests pass (§13 has the numbers). Desktop runbook P1–P17 with P5b–P5d (§12.5) passed 2026-10-07; the phone check moved to Batch 7 §13 (M8). Deviations found while building are marked **(as built)**. |
| Depends on | Batch 4 (checkout, `createOrderSchema`, `delivery.service`) |
| Brief sections | §2 customer 8–10, §3 (customer COD copy), §6 separate orders, §8 server fees, §10 + §11 enforcement, §14 Inventory, §15 Order data, §25 Order creation, §26 Abuse protection |
| Endpoints | `POST /api/orders`, `POST /api/orders/lookup` |
| Rules used | Batch 1 §6.4 (S1–S8), §6.6, §6.7, §6.11, §6.12, §7.5, §8.4 |

## 1. Goal

Placing an order is correct under every condition. The server sets prices, fees and totals. Stock can't be oversold, even when two people order the last item in the same instant. Double taps and flaky mobile networks never create two orders. Any failure leaves no partial order and no stock change. The customer ends on a confirmation with the order ID, where and when the food arrives, and the cash-on-delivery total, and can look the order up later.

This is the batch that protects the vendor's food and the customer's trust. Its concurrency tests must stay green for the rest of the project.

## 2. Scope

**In:**

- `inventory.service.ts` complete: `reserveStock`, `restoreStockForOrder`, `setTodayStock`. Batch 6 calls the last two; they are built and tested here so all stock SQL lands in one reviewed change.
- `order.service.ts`: `createOrder`, `lookupOrder`, `toPublicOrderView`.
- Routes, order and lookup rate limits, the per-phone cap, and a guard test that keeps stock writes inside `inventory.service.ts`.
- `seed-dev` switched to `setTodayStock`.
- Client: submission with an idempotency key, error handling for every code, confirmation page, `/order/:orderNumber`, `/track`, recent orders on this phone.

**Out:** vendor actions (complete, cancel, collect) and stock screens (Batch 6).

## 3. `inventory.service.ts`

The only module that writes `daily_stock`, `stock_remaining` or `stock_date` (Batch 1 S7). Every function takes a `Prisma.TransactionClient`, so it can only be called inside a transaction. SQL is Batch 1 §7.5, through tagged templates only.

```ts
reserveStock(tx, businessDate: string, lines: { menuItemId: number; quantity: number }[])
  : Promise<{ id: number; name: string; price: number }[]>
```

- Sorts lines by `menuItemId` ascending, then runs the conditional decrement per line.
- Zero rows for a line → re-read that item and throw `OUT_OF_STOCK` with `{ menuItemId, name, available }` (available = 0 if the item's stock isn't for today).
- Returns name and price from the **updated rows**, so the prices used are the ones on the locked rows.

```ts
restoreStockForOrder(tx, order: { deliveryDate: string; items: { menuItemId: number; quantity: number }[] })
  : Promise<{ restoredLines: number }>
```

- The caller has already locked the order row (Batch 6 status machine).
- Per item, ascending `menuItemId`: add the quantity back only where `stock_date = order.deliveryDate` (Batch 1 S5). Lines whose item is now stocked for another day are skipped silently.

```ts
setTodayStock(tx, businessDate: string, entries: { menuItemId: number; stock: number }[])
  : Promise<StockRow[]>
```

**(as built)** It returns `StockRow[]` (`{ id, dailyStock, stockRemaining, stockDate: 'YYYY-MM-DD' }`, one per entry, in ascending id order), not `AdminMenuItem[]`: that type is Batch 6's admin view, and building it here would scaffold Batch 6 early. Batch 6 maps the rows to its view (Batch 6 §6).

- Ascending `menuItemId`; one statement per entry (Batch 1 S3).
- Zero rows → re-read: missing or deleted → collect `NOT_FOUND`; otherwise collect `{ menuItemId, sold }` for `STOCK_BELOW_SOLD`.
- After the loop, if anything was collected, throw (the caller's transaction rolls everything back); `STOCK_BELOW_SOLD` takes precedence and lists every offending item.

**Guard test** (`tests/unit/stock-writes-guard.test.ts`): scan `src/server/**/*.ts` except `inventory.service.ts` and the generated Prisma client (`src/server/generated/**`), and fail on either pattern:

- SQL: `/UPDATE\s+menu_items[\s\S]{0,300}?\b(stock_remaining|daily_stock|stock_date)\b/i`
- Prisma: `/menuItem\.(update|updateMany|upsert|create|createMany)\([\s\S]{0,400}?\b(stockRemaining|dailyStock|stockDate)\b/`

**(as built)** The guard is wider than this: it also scans `prisma/*.ts` (`seed-initial` runs in production) and `scripts/**`, and bans `$queryRawUnsafe` / `$executeRawUnsafe` everywhere outside generated code (Rule 12). A self-test checks that the patterns match known-bad snippets, so the guard can't pass vacuously.

It's a heuristic backed by code review. The admin menu schemas (Batch 6) are strict objects without stock fields, so stock can't leak in through a request body either.

## 4. `createOrder`

Algorithm: Batch 1 §6.12. Implementation notes:

```ts
createOrder(deps: { prisma; clock; logger }, input: CreateOrderOutput, ctx: { reqId: string })
  : Promise<{ order: PublicOrderView; replayed: boolean }>
```

**(as built)** `ctx` carries `reqId`, the codebase's request-id name (this spec said `requestId`), and `deps` carries the `logger`. The service calls `toPublicOrderView` itself, because it already reads `contactPhone` from settings. The route only picks `201` or `200` and adds `replayed`.

1. **Idempotency fast path** outside the transaction: `findUnique({ where: { clientRequestId } , include: { items: true } })`. If it exists: same phone → `{ replayed: true }`; different phone → `IDEMPOTENCY_CONFLICT`.
2. `prisma.$transaction(fn, { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 10_000 })`.
3. Inside, in order:
   1. settings → `ORDERS_PAUSED`;
   2. merge duplicate lines → re-check `MAX_QTY_PER_ITEM` (`VALIDATION_ERROR` on `items`);
   3. `today = nowIST(clock)` (computed once and used for every check in this order);
   4. delivery rules using `slotStatus` / `expressStatus` from `delivery.service` (Batch 4 §3) on rows loaded in this transaction:
      - BATCH: slot missing → `VALIDATION_ERROR`; `slot.locationId ≠ input.locationId` → `VALIDATION_ERROR` (field `slotId`); location inactive → `LOCATION_UNAVAILABLE`; slot status not open → `SLOT_CLOSED` with `reason` and `expressAvailable`;
      - EXPRESS: express not available → `EXPRESS_UNAVAILABLE` with `reason`; location missing → `VALIDATION_ERROR`; inactive → `LOCATION_UNAVAILABLE`;
   5. per-phone cap: `count({ where: { customerPhone, deliveryDate: today, status: 'ORDER_RECEIVED' } })` ≥ `MAX_OPEN_ORDERS_PER_PHONE` → `TOO_MANY_OPEN_ORDERS`;
   6. item pre-check (one `findMany`) → `ITEM_UNAVAILABLE` (all bad ids) or `OUT_OF_STOCK` (all short items);
   7. `reserveStock` (authoritative; may still throw `OUT_OF_STOCK` if another order won the race);
   8. totals via `computeTotals` using the reserved prices and the fee for the mode;
   9. `total ≠ expectedTotal` → `PRICE_CHANGED` with `{ total }`;
   10. `tx.order.create` with nested items and snapshots:
       `locationName`, `slotDeliveryTime` (BATCH), `expressEtaMinMinutes` / `expressEtaMaxMinutes` (EXPRESS), item `itemName` / `unitPrice` / `lineTotal`, `deliveryDate: toDbDate(today.date)`, `createdAt: today.instant`.
4. **Unique violation** (`P2002`) from the insert: a concurrent duplicate won. Load that order and apply step 1's rules. **(as built)** `meta.target` is not parsed (driver adapters shape it differently): any `P2002` from the insert triggers the `clientRequestId` re-lookup, and if no order turns up the error is rethrown (`isUniqueViolation`, `src/server/lib/db-errors.ts`).
5. **Rejection re-check** (Batch 1 §6.12 step 14): if the transaction throws an `AppError`, re-run step 1's lookup once. If the order now exists, return it (`replayed: true`, or `IDEMPOTENCY_CONFLICT` for a different phone); otherwise rethrow the original error. This stops an overlapping retry from reporting `OUT_OF_STOCK` or `TOO_MANY_OPEN_ORDERS` for an order that was placed.
6. **Deadlock or serialization failure** (`40P01` / `40001`, Prisma `P2034`): retry the whole transaction once. With the fixed lock order this shouldn't happen; the retry is a safety net and is logged as a warning. **(as built)** `isRetryableTxError` accepts Prisma `P2034`, or SQLSTATE `40P01` / `40001` as a whole word anywhere in the error's code, meta or message (a raw query reports a deadlock as `P2010` "Raw query failed. Code: `40P01`"; the same text-match approach `constraints.test.ts` uses for `23514`). The retry reuses the first attempt's IST "now", so one order has one "now" (step 3.3) and a safety-net retry can't drift past a cutoff or into the next day.
7. Log `order.created` with `orderNumber`, `deliveryMode`, `total`, `reqId`. Never name, phone or address. Rejections log `order.rejected` with the error code. **(as built)** `reqId` is the codebase's request-id name (see the note above), and the retry logs `order.retry` (warn) with `reqId`.

Route: `POST /api/orders` → `orderRateLimit` → `validate(createOrderSchema)` → `createOrder` → `201` (new) or `200` (replay) with `toPublicOrderView(order, settings.contactPhone)` plus `replayed`.

`toPublicOrderView` builds `expressWindow` from `createdAt` + snapshotted minutes with `addMinutesIST` (`{ from, to, etaText }`), and omits the internal `id`, the phone and the timestamps other than `createdAt`. **(as built)** The public view is a strict zod schema (`publicOrderViewSchema` in `schemas/order.ts`) and `PublicOrderView` is derived from it, the same pattern as the menu and delivery options. The integration tests parse every response with it, so a leaked `id` or phone fails. Items keep cart order: merged lines keep each item's first position, and the view orders items by `order_items.id`.

## 5. Lookup

- `lookupSchema` (shared): `orderNumber` trimmed and upper-cased; digits only (`1023`) gets the `BB` prefix; must match `^BB\d{4,9}$`. `phone` via `customerPhoneSchema`.
- `lookupOrder(prisma, { orderNumber, phone })`: `findUnique` by `orderNumber`; missing **or** phone different → `ORDER_NOT_FOUND`. One code path, so both cases return the same body.
- Route: `POST /api/orders/lookup` → `lookupRateLimit` (counts failed lookups only) → validate → `200` public order view (without `replayed`).

## 6. Rate limits and abuse

| Limit | Where | Value (Batch 1 §6.11) | Notes |
|---|---|---|---|
| `orderRateLimit` | `POST /api/orders` | 60 / 10 min / IP | counts every attempt; generous because of hostel NAT |
| `lookupRateLimit` | `POST /api/orders/lookup` | 30 failed / 10 min / IP | `skipSuccessfulRequests: true`: stops enumeration of sequential order numbers (guesses fail and count), while the confirmation page's 60 s refresh (§8.1) never uses it up, even for a whole hostel on one Wi-Fi IP |
| per-phone open orders | inside `createOrder` | 3 for today | cancelled and completed orders don't count |

All limits come from `createApp` options so tests can lower them.

## 7. Client: placing the order

### 7.1 `clientRequestId`

- `lib/uuid.ts`: `crypto.randomUUID()` when available; otherwise a v4 UUID built from `crypto.getRandomValues` (needed on `http://<lan-ip>` during phone testing, where `randomUUID` doesn't exist).
- On tap, compute a **fingerprint** of the request without its id (stable JSON of mode, slot, location, details, items, expected total).
- `sessionStorage['bbc.pendingOrder.v1'] = { clientRequestId, fingerprint }`. Same fingerprint as the stored one → reuse the id (retry, double tap). Different → new id (the customer changed something).
- Cleared on success. **(as built)** The pair is also mirrored in module memory, so if `sessionStorage` is blocked (private mode, site data off) a retry still reuses the id instead of minting a new one (`pending-order.ts`).

This makes "Try again" after a timeout safe: if the first attempt reached the server, the retry returns the same order (`200`, `replayed: true`).

### 7.2 Submitting

- Button shows a spinner and "Placing order…", `aria-busy`; the form's `fieldset` is disabled so nothing changes mid-flight.
- Client timeout 15 s (`AbortController`); treated like a network error.
- **(as built) Try again resends the frozen request.** After a network, timeout or 5xx failure, the exact request (same id, same body) is kept. **Try again** resends it unchanged, even if prices or the cutoff changed in between, so a replay is never turned into `PRICE_CHANGED` or `SLOT_CLOSED` for an order that exists. The button stays enabled for that retry even when orders are now paused or nothing is open: the idempotency check comes before the pause check (D19), so the retry gets the order that was placed. Any customer edit drops the frozen request and clears the network banner with it; from then on the fingerprint decides the id (§7.1).
- **(as built) No reconcile while an order is in flight or frozen.** While an order is being sent, or a request is frozen for Try again, checkout's menu refreshes don't reconcile the cart (`useMenu({ reconcile: menuMayReconcile({ submitting, frozen }) })`; the menu and order pages always reconcile). The customer's own order may have sold out the cart, and reconciling would empty it and redirect to the menu, losing Try again for an order that may exist. Try again then replays the order or, if it wasn't placed, its `OUT_OF_STOCK` fixes the cart (`applyStock`, §7.3). Afterwards the next fetch reconciles as usual. The in-flight half was added in the Batch 5 follow-ups (2026-10-07): a refresh landing while the first request was still pending could empty the cart before the request failed. Runbook P5c.
- **(as built) Navigation after success.** `CheckoutPage` holds `placed` and skips its empty-cart `<Navigate to="/">` once an order is placed, so clearing the cart can't race the navigation to the confirmation. While `placed` and the cart is empty it renders the checkout header plus the existing skeleton (`role="status"`), not a blank screen, until the route changes. The draft timer also skips writing once placed.
- **On success** (`201` or `200`):
  1. add `{ orderNumber, phone, deliveryDate }` to recent orders (§10);
  2. save remembered details (`bbc.customer.v1`, Batch 4 §7);
  3. clear the cart, checkout draft and pending order;
  4. `navigate('/order/BB1023', { replace: true, state: { order, phone, placed: true } })`, so Back goes to the menu, not a stale checkout.

### 7.3 Errors

Every error re-enables the form. Banners appear at the top of the checkout and receive focus.

| Code | Behaviour | Copy |
|---|---|---|
| `VALIDATION_ERROR` | map `fieldErrors` onto fields; focus the first | field messages from the schema |
| `ORDERS_PAUSED` | revalidate options; button disabled | "Orders are temporarily paused. Please check again shortly." |
| `SLOT_CLOSED` | revalidate options; clear slot; offer Try Express if `details.expressAvailable` | "Orders for MSH — 8:00 PM just closed." + "Batch orders for MSH are closed. Express delivery is available." |
| `LOCATION_UNAVAILABLE` | revalidate; clear location | "Delivery to this location isn't available right now. Please choose another." |
| `EXPRESS_UNAVAILABLE` | revalidate; clear method | "Express delivery is currently unavailable." |
| `ITEM_UNAVAILABLE` | revalidate menu (reconciliation removes the items) | "Some items are no longer available and were removed. Please check your order." |
| `OUT_OF_STOCK` | cap each listed line at `available` or remove it at 0; revalidate menu | "Only 2 Chicken Biryani left. We've updated your order. Please check it and place it again." / "Chicken Biryani just sold out and was removed." |
| `PRICE_CHANGED` | revalidate menu and options; the summary shows the new total | "Prices changed since you opened the menu. Please check the new total and place your order again." |
| `TOO_MANY_OPEN_ORDERS` | none | "You already have 3 orders waiting for delivery today. Please wait for them to arrive or contact Bunty Biryani Centre." (+ contact number if set) |
| `IDEMPOTENCY_CONFLICT` | new id | "Something went wrong. Please tap Place order again." |
| `RATE_LIMITED` | none | "Too many attempts. Please wait a minute and try again." |
| network, timeout, `5xx` | keep the pending id; button becomes "Try again" | "We couldn't confirm your order. Check your connection and tap Try again. You won't get a duplicate order." |

**(as built)**

- **`applyStock`.** `OUT_OF_STOCK` and `ITEM_UNAVAILABLE` fix the cart through a new reducer action, `applyStock`, which caps or removes lines without cart notices (the checkout banner carries the message). If the cart ends up empty, the existing empty-cart redirect applies and the menu shows those items as sold out.
- **`OUT_OF_STOCK` for several items:** one sentence per item ("Only 2 Chicken Biryani left." / "Paneer Biryani just sold out and was removed."), then "We've updated your order. Please check it and place it again." when at least one item was capped. A single item gives the two examples above word for word.
- `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT` and the server's `VALIDATION_ERROR` can't reasonably be provoked by hand. Their UI paths are covered by `submit-errors.test.ts` plus the integration tests (#19, #21, #10 / #14), with e2e coverage in Batch 7.

## 8. Confirmation and order status (`/order/:orderNumber`)

### 8.1 Data source

1. Router state from the submit, rendered at once. **(as built)** It is only the instant fallback data: the page **always revalidates on mount** through lookup. History state survives reloads and tab restores, so a stale "Pay ₹300 in cash" on a cancelled order would mislead the customer. A successful lookup doesn't count against the failed-only limit (§6), so this costs one extra request per view. Router state that is stale, for another order number or malformed is ignored (`order-state.ts`).
2. Else the phone saved for this order number in recent orders → `POST /api/orders/lookup`.
3. Else the `/track` form inline (`TrackForm`, the one component `/track` also uses), with the order number prefilled.

While the status is `ORDER_RECEIVED`, refresh via lookup on focus and every 60 s. **(as built)** `refreshInterval` falls back to the fallback data's status while the cache is empty (SWR never writes `fallbackData` to the cache), and the options object is memoised so re-renders don't restart the countdown. The lookup uses `shouldRetryOnError: false`: SWR's default error retry would turn one 404 into several failed lookups and use up the IP's failed-lookup allowance.

### 8.2 Layout

```
            ✓
       ORDER PLACED
      Your order ID
         BB1023                [Copy]
  Keep this ID to check your order.

DELIVERY
  Batch · MSH
  Today, 8:00 PM
  Room 214, B block

  (Express:  Express · Kanhar
             Approx. 30–40 minutes (around 7:40–7:50 PM))

YOUR ORDER
  Chicken Biryani × 2              ₹300
  Delivery                         Free
  Total                            ₹300
  Payment: CASH ON DELIVERY
  Pay ₹300 in cash when your food arrives.

  Need help? Call 98765 43210

[ Order more ]          [ Track an order ]
```

- The order ID is Archivo 800, about 40 px, letter-spaced, selectable. **Copy** uses `navigator.clipboard.writeText` (fallback: select the text) and shows "Copied" for 2 s.
- Heading by status:
  - just placed → "ORDER PLACED" (success icon);
  - `ORDER_RECEIVED` on a later visit → "ORDER BB1023" + chip "Order received";
  - `COMPLETED` → chip "Completed";
  - `CANCELLED` → danger banner "This order was cancelled. Contact Bunty Biryani Centre if you have questions." with the contact number if set.
- Payment line: "Payment: CASH ON DELIVERY" while pending; "Cash on delivery · Collected" after the vendor marks it. Never "Paid" (Batch 1 C4).
- Batch time: "Today, 8:00 PM" when `deliveryDate` is today, else "Sun, 4 Oct, 8:00 PM". **(as built)** "Today" comes from `useMenu().data.businessDate` (the server's IST date; the browser clock is never used), which also prefetches the menu for "Order more". While it is unknown the full date is shown. An express order from another day gets the date as a prefix (this spec didn't cover that case).
- Express: "Approx. 30–40 minutes (around 7:40–7:50 PM)"; never an exact time (brief §7).
- "Need help?" shows only when `contactPhone` is set, as a `tel:` link.

## 9. Track page (`/track`)

- Fields: Order ID (`autocapitalize="characters"`, placeholder "BB1023", accepts digits only) and Mobile number (same as checkout). Button "Find order".
- Success → add to recent orders → `/order/:orderNumber` with state.
- `404` → danger banner "We couldn't find an order with that ID and mobile number." (one message for both causes).
- `429` → "Too many attempts. Please wait a minute and try again."
- **Orders on this phone:** list from recent orders, newest first: "BB1023 · Sun, 4 Oct" → opens the order. Empty → no list.
- Links: "Track an order" in the menu footer and on the confirmation page.
- **(as built)** The form is one component, `TrackForm` (`TrackPage.tsx`), used by `/track` and by the order page's fallback (§8.1 case 3).

## 10. Recent orders (`localStorage['bbc.orders.v1']`)

Array of `{ orderNumber, phone, deliveryDate }`, newest first, de-duplicated by order number, max 10. zod-validated, try/catch, junk discarded. It stays on the customer's own device and holds nothing they didn't type themselves.

## 11. Edge cases

| Case | Handling |
|---|---|
| Double tap | Button disabled on first tap; any duplicate carries the same id → one order. |
| Network drops after the server committed | "Try again" resends the same id → `200 replayed` → normal confirmation. |
| Retry overlaps the original request, for the last item | The retry waits on the original's stock lock, then sees stock 0; the rejection re-check (§4 step 5) finds the original order → `200 replayed`, not "sold out". |
| App backgrounded mid-submit | On return the form shows the network error with "Try again" (same id). |
| A request stalls past the 15 s client timeout and the customer taps Try again | Known limitation: the retry can be rejected before it waits on any lock (for example `ORDERS_PAUSED` or `SLOT_CLOSED` if the vendor acted in between), and the original may still commit a moment later. The customer then sees an error for an order that exists; it shows on the vendor's dashboard and in Track an order. The window is very narrow; accepted for Phase 1. |
| Tab closed before the response arrived | Known limitation: the customer doesn't have the ID. The order is on the vendor's dashboard with their phone; they can contact the vendor. Auto-resubmitting later is deliberately not done (it could create an order the customer gave up on). |
| Two people order the last biryani together | Conditional decrement: exactly one succeeds; the other gets `OUT_OF_STOCK` with `available: 0`. |
| Cart from yesterday reaches the server | Items stocked for yesterday → `OUT_OF_STOCK` (available 0). |
| Request arrives at 19:29:59.9 for a 19:30 cutoff | Server time at transaction start decides; it is 19:29, so accepted. |
| Short stock **and** changed price | `OUT_OF_STOCK` comes first (step 6–7); the price check runs on the next attempt. |
| Vendor pauses orders while the request is in flight | Whichever commits first wins; at most this one order slips through. Acceptable. |
| Order number gaps | Expected (Batch 1 D15). |
| Lookup with `bb1023`, `1023` or ` BB1023 ` | All found. |
| Confirmation refreshed with storage blocked | Inline track form with the order number prefilled. |

## 12. Tests

All integration tests use real Postgres, `seed-initial` data and these items unless stated: **A** Chicken Biryani ₹150 (stock 5 today), **B** Paneer Biryani ₹130 (stock 5 today), **C** Raita ₹20 (stock 1 today). Test clock 19:10 IST unless stated. `assertInventoryInvariant()` (Batch 1 §7.5) runs after every test and must return zero rows.

### 12.1 `tests/integration/orders.create.test.ts`

**Happy paths**

1. Batch MSH, 2 × A → `201`; `orderNumber: "BB1001"`; `status: ORDER_RECEIVED`; `paymentMethod: COD`; `paymentStatus: PENDING`; `deliveryFee: 0`; `total: 300`; `slotDeliveryTime: "20:00"`; `locationName: "MSH"`; A remaining 3; DB row has the snapshots and `created_at` equal to the test clock.
2. Express Kanhar, 2 × A → `deliveryFee: 30`, `total: 330`; `slot_id` null; `expressWindow: { from: "19:40", to: "19:50" }`; ETA minutes snapshotted.
3. A second order gets `BB1002`.
4. Lines `[{A,2},{A,3}]` → one order item with quantity 5.
5. Snapshots: after the order, change A's price, rename MSH and move the slot to 20:15 → lookup still shows ₹150, "MSH" and "20:00".

**Rejections** (each also asserts no order row and unchanged stock)

6. `orders_paused` → `409 ORDERS_PAUSED`.
7. 19:30 IST, batch MSH → `409 SLOT_CLOSED`, `reason: CUTOFF_PASSED`, `expressAvailable: true`.
8. MSH `closed_on` today → `SLOT_CLOSED`, `CLOSED_TODAY`.
9. Inactive slot → `SLOT_CLOSED`, `INACTIVE`. Active slot at an inactive location → `LOCATION_UNAVAILABLE`.
10. Kanhar's slot with `locationId` MSH → `400 VALIDATION_ERROR` on `slotId`.
11. Express with express disabled → `EXPRESS_UNAVAILABLE`, `DISABLED`; at 10:00 IST → `OUTSIDE_HOURS`; inactive location → `LOCATION_UNAVAILABLE`.
12. Express payload containing `slotId` → `400`.
13. Disabled item, deleted item, unknown id 9999 → `ITEM_UNAVAILABLE` listing each id.
14. Quantity 11 → `400`; `[{A,6},{A,5}]` (merged 11) → `400`; 11 lines → `400`.
15. 6 × A and 6 × B → `OUT_OF_STOCK` listing both with `available: 5`.
16. Item stocked yesterday → `OUT_OF_STOCK` with `available: 0`.
17. `expectedTotal: 299` for a ₹300 order → `409 PRICE_CHANGED`, `details.total: 300`, stock unchanged. (This also proves the reservation is rolled back, because it runs after `reserveStock`.)
18. Per-phone cap: three orders succeed, the fourth → `429 TOO_MANY_OPEN_ORDERS`. After one is marked `COMPLETED` (direct DB update), the next succeeds. Cancelled orders don't count.
19. Order rate limit lowered to 2 → third request `429 RATE_LIMITED` with `Retry-After`.

**Idempotency**

20. Same body twice in sequence → `201` then `200` with `replayed: true`, same order number, one row, stock decremented once.
21. Same `clientRequestId`, different phone → `409 IDEMPOTENCY_CONFLICT`.
22. Five identical requests via `Promise.all` → exactly one order row; all five responses carry the same order number; one `201`, four `200`. **Last item:** C has 1 left; two concurrent requests with the same `clientRequestId` for 1 × C → one `201` and one `200 replayed` with the same order number (never `OUT_OF_STOCK`); C remaining 0. **Cap:** a phone with 2 open orders sends its third order twice concurrently with one id → one `201`, one `200` (never `TOO_MANY_OPEN_ORDERS`).

**Concurrency**

23. Last item: C has 1 left; two different customers order 1 × C concurrently → exactly one `201` and one `409 OUT_OF_STOCK` (`available: 0`); C remaining 0.
24. A has 5; ten concurrent orders of 1 × A → exactly five `201`, five `OUT_OF_STOCK`; A remaining 0.
25. Lock order: ten rounds of `[A,B]` and `[B,A]` submitted concurrently → every response is `201` or `OUT_OF_STOCK`; no `500`, no deadlock in the logs.

**(as built)** Test details this section left open (tests live in `orders.create.test.ts` and `orders.concurrency.test.ts`):

- **#24, #25:** each request uses a distinct phone; the per-phone cap of 3 would otherwise reject them.
- **#25:** 20 requests at once (alternating `[A,B]` / `[B,A]`), with A and B stocked 20. It asserts **no `order.retry` warning**: without the sorted lock order the deadlock would be retried silently and the test would still pass.
- **#18 "cancelled don't count":** uses `CANCELLED` order rows without items. A direct status update on a real order would break the inventory invariant.
- **D1, D2:** a replay ignores a changed body (price, cutoff), and a replay while orders are paused returns `200` (D19).

### 12.2 `tests/integration/orders.lookup.test.ts`

26. Correct phone in another format (`+91 98765-43210`) → `200` public view.
27. Wrong phone → `404 ORDER_NOT_FOUND`; unknown order → `404` with a byte-identical body.
28. `bb1001` and `1001` both find `BB1001`.
29. Lookup rate limit lowered to 2 → two failed lookups, then a third → `429`; on a fresh limiter, ten successful lookups in a row never get `429`.
30. The response contains no internal `id` and no phone number.

### 12.3 `tests/integration/inventory.test.ts`

31. New day: item stocked yesterday (daily 10, remaining 2) → `setTodayStock(20)` → daily 20, remaining 20, `stockDate` today.
32. Same day: daily 10 with 6 sold through real orders (remaining 4) → set 15 → remaining 9; set 6 → remaining 0; set 5 → `STOCK_BELOW_SOLD` with `sold: 6`, nothing changed.
33. Bulk: three entries, one below sold → nothing changes; the error lists only that item. Unknown id → `NOT_FOUND`.
34. `restoreStockForOrder` for today's order → stock returned. For yesterday's order whose item is now stocked today → unchanged.

**(as built)** #32 and #34 need real orders, so they place orders through `POST /api/orders` with the shared fixtures (`order-fixtures.ts`). #34 cancels in one transaction (lock the row, set `CANCELLED`, `restoreStockForOrder`), the way Batch 6's status machine will. R1, R2 are the `reserveStock` cases in the same file.

### 12.4 Unit

35. Stock-writes guard (§3).
36. `uuid` fallback output passes `z.uuid()`; 1,000 generated ids are unique.
37. Fingerprint: identical requests → same; changing any field → different.
38. `toPublicOrderView`: batch shape; express window `19:40`–`19:50` for a 19:10 order with 30–40; window across noon formats correctly; no `id`, no phone.
39. `lookupSchema`: `bb1023`, `1023`, ` BB1023 ` → `BB1023`; `XX1023`, `BB12` → rejected.

**(as built)** Also unit-tested: `db-errors` (`isUniqueViolation`, `isRetryableTxError`), `submit-order` and the button state (including Try again while paused), every error mapping and the multi-item `OUT_OF_STOCK` copy (`submit-errors`), the pending id with storage blocked (PO1–PO4), `recent-orders`, `applyStock` (in `cart.test.ts`), the order-page router-state guard (OS1–OS3) and `shouldRetryOnError === false` (OS4), and the checkout and order markup.

### 12.5 Manual

**Setup (desktop rows):** `docker compose up -d --wait; pnpm db:seed; pnpm dev`; Chrome device mode 360×740 on `http://localhost:5173`. Open the slots first with Batch 4's runbook statement (cutoff now + 60 min). Run SQL with `docker compose exec db psql -U bbc -d bbc_dev -c "<SQL>"`. To provoke an error code, run the SQL *after* the checkout has loaded and tap within 30 s, before the options or menu refresh.

| # | Action | Expected |
|---|---|---|
| P1 | 2 Chicken + 1 Raita → Batch MSH → details → Place order | Spinner and "Placing order…", then `/order/BB1001`: "ORDER PLACED", Batch · MSH, Today + time, ₹320, "Payment: CASH ON DELIVERY". Back → menu, cart empty |
| P2 | Reload the confirmation | The same order, loaded through lookup (recent orders) |
| P3 | Express Kanhar order | "Approx. 30–40 minutes (around …)", +₹30 |
| P4 | Copy | "Copied" for 2 s; the clipboard holds the ID |
| P5 | DevTools Offline → Place order → online → Try again | The network banner (focused), the button reads "Try again", then the confirmation. `SELECT count(*) FROM orders` has gone up by exactly 1 |
| P5b | A DevTools custom throttling profile with 20 000 ms latency → tap Place order → after ~2 s switch to Offline → wait for the network banner → check that a new row exists (if not, the request never left; repeat) → `UPDATE menu_items SET price = price + 10 WHERE name = 'Raita'` → go online → Try again | The confirmation shows the **original** total; the order count went up by exactly 1 |
| P5c | The 20 000 ms latency profile → dev-only `UPDATE menu_items SET daily_stock=1, stock_remaining=1 WHERE name='Raita'`, and a cart of just 1 Raita → tap Place order → after ~2 s switch to Offline → wait for the network banner → check that a new row exists (if not, repeat) → go online → focus away and back (or wait 60 s) so the menu refreshes | The checkout is still there with "Try again" (Raita isn't removed); tapping it opens the confirmation with the original order; the order count went up by exactly 1 |
| P5d | (Batch 5 follow-ups) Hold the order's response until the 15 s client timeout; dev-only Raita stock 1 and a cart of just 1 Raita → tap Place order → while "Placing order…" shows, let the menu refresh (return to the tab) → wait for the timeout → Try again | During the wait the cart keeps Raita and the page stays on checkout; then the network banner and "Try again"; Try again opens the confirmation; the order count went up by exactly 1 |
| P6 | `orders_paused = true`, tap | The paused banner; the button disabled once options refresh. Reset |
| P7 | MSH `cutoff_time` = 1 minute ago, tap | "Orders for MSH — … just closed." + "Batch orders for MSH are closed. Express delivery is available." + Try Express selects Express MSH |
| P8 | Express Kanhar; `UPDATE delivery_locations SET is_active=false WHERE name='Kanhar'`, tap | The location-unavailable banner; the location cleared. Reset |
| P9 | Express selected; `express_enabled=false`, tap | "Express delivery is currently unavailable."; the method cleared. Reset |
| P10 | `UPDATE menu_items SET is_available=false WHERE name='Raita'`, tap | The item-unavailable banner; Raita gone from the order. Reset |
| P11 | 2 Chicken in the cart; dev-only `UPDATE menu_items SET daily_stock=1, stock_remaining=1 WHERE name='Chicken Biryani'`, tap | "Only 1 Chicken Biryani left. We've updated your order…"; the line capped at 1 |
| P12 | `UPDATE menu_items SET price=160 WHERE name='Chicken Biryani'`, tap | The price-changed banner; the summary shows the new total; the next tap succeeds |
| P13 | Three orders with one phone, then a fourth | The too-many banner (+ "Call …" if `contact_phone` is set) |
| P14 | `/track`: `bb1001` + a wrong phone, then `1001` + the right phone | The not-found banner, then the order page. "Orders on this phone" lists it |
| P15 | `UPDATE orders SET status='COMPLETED', completed_at=now() WHERE order_number='BB1001'`; open it from /track | "ORDER BB1001" + "Completed"; the 60 s refresh stops |
| P16 | Another order: `payment_status='COLLECTED'`; a third: `status='CANCELLED'` | "Cash on delivery · Collected"; the danger cancelled banner. Never "Paid" |
| P17 | 320 px wide, confirmation + track | No horizontal scroll; the ID doesn't overflow |
| Phone (owner) | Items 1–4 below on a real Android phone (`pnpm dev:server` + `pnpm exec vite --host`). **Moved to Batch 7 §13 (M8) on 2026-10-07.** | As listed |
| Reset | `pnpm db:seed`, then Batch 4's slot/settings reset SQL, `UPDATE delivery_locations SET is_active=true` | |

**Phone (owner):**

1. Place a batch order and an express order; check the confirmation for each, then reload it.
2. Look up an order with the wrong phone, then the right one.
3. DevTools → Offline, tap Place order → error; go online, tap Try again → one order in the database (`SELECT count(*) FROM orders`).
4. Two phones, last item: only one gets it; the other sees the sold-out message and an updated cart.

`RATE_LIMITED`, `IDEMPOTENCY_CONFLICT` and the server's `VALIDATION_ERROR` can't reasonably be provoked by hand (§7.3).

**(as built) Desktop run, 2026-10-07:** P1–P17, P5b, P5c and P5d passed in desktop Chrome (Claude in Chrome), window about 560 px wide. Adaptations, because DevTools can't be driven from the extension:
- Offline and lost responses (P5–P5d) were simulated with a page-level `fetch` wrapper for `POST /api/orders`: fail before sending (P5); send, then drop the response (P5b, P5c); send, then hold until the client's 15 s abort (P5d). In P5b–P5d the server had saved the order (201) before the page saw a failure.
- P17 loaded `/`, `/checkout`, `/order/:n` (a later visit, and the just-placed view via router state) and `/track` in a 320 px same-origin iframe: no element overflowed, and the 40 px order ID was 172 px wide.
- The run was at 10:15 IST, before express opens, so `express_opens_at` was set to 06:00 for the run, with `contact_phone` set to show the help lines; both were restored.
- P15's "the 60 s refresh stops" is covered by unit test OS4: the unfocused test window paused SWR polling, so it couldn't be observed. For the same reason the menu refresh in P5c and P5d was triggered by the page becoming visible again.

## 13. Definition of done

- [x] `inventory.service.ts` complete; the guard test passes; `seed-dev` uses it.
- [x] `createOrder` follows Batch 1 §6.12 step for step; `POST /api/orders` and lookup match Batch 1 §8.4.
- [x] All tests in §12.1–§12.4 pass, including the concurrency tests, with the invariant checked after each. **(as built)** `pnpm test`: 34 files, 442 tests after the follow-ups (Batch 4 ended at 20 files, 284 tests). `orders.concurrency.test.ts` (11 tests) passed three runs in a row.
- [x] Every error code in §7.3 has a tested UI path (manual now, e2e in Batch 7). **(as built)** Unit-tested in `submit-errors.test.ts`; manually in runbook P5–P13 (2026-10-07). `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT` and the server's `VALIDATION_ERROR` are covered by unit and integration tests only.
- [x] Desktop runbook P1–P17 (§12.5) passes. **(as built)** Passed 2026-10-07, with P5b, P5c and P5d (see the note under §12.5).
- [x] Phone check (§12.5, owner), or moved to Batch 7 §13 as Batches 3 and 4 did. **(as built)** Moved to Batch 7 §13 (M8) on 2026-10-07.
- [x] No name, phone or address in logs.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass; `CLAUDE.md` batch table updated. **(as built)** Measured with `NODE_ENV` unset (see §14): the `/` entry chunk is 123.68 KB gzipped JS plus 5.33 KB gzipped CSS, inside the 130 KB budget (Batch 1 §10.5); it was 127.34 KB at the end of Batch 4. `dist/client` contains no `style="` attribute.

## 14. Files

- Server: `src/server/services/{inventory.service,order.service}.ts`, `src/server/routes/orders.ts`, `src/server/lib/db-errors.ts`, wiring and `limits.order` / `limits.lookup` in `app.ts`, `prisma/seed-dev.ts` (uses `setTodayStock`). **(as built)** The two rate limits already existed in `shared/limits.ts` and `createLimiter` (with its `failedOnly` option), so `middleware/rate-limits.ts` didn't change.
- Shared: `src/shared/schemas/order.ts` (`lookupSchema`, `publicOrderViewSchema`, `createOrderResponseSchema`), `schemas/delivery.ts` (exports `hhmmSchema`), `api-types.ts` (`PublicOrderView`).
- Client:
  - `src/client/lib/uuid.ts`;
  - `features/customer/checkout/{submit-order,pending-order,error-handling}.ts`, `SubmitErrorBanner.tsx`, and edits to `CheckoutPage`, `PlaceOrderBar`, `SummarySection`;
  - `features/customer/order/{OrderPage,OrderDetails,TrackPage,RecentOrders}.tsx` and `{order-state,order-display,recent-orders-storage,use-order-lookup}.ts`;
  - `applyStock` in `cart-reducer.ts` and `CartProvider.tsx`, and `useMenu`'s `reconcile` option (`menu/use-menu.ts`, §7.2);
  - `copy.ts` additions;
  - `App.tsx` routes.
- **(as built) Lazy customer routes.** `/checkout`, `/order/:orderNumber` and `/track` are `React.lazy` chunks (`src/client/lazy-routes.ts`), each inside a `Suspense` and a `RouteErrorBoundary` (`src/client/components/RouteErrorBoundary.tsx`, a small class component with no dependency). A failed chunk load shows an error state whose retry reloads the whole page, because `React.lazy` caches a failed import. The checkout chunk is prefetched once the cart has items (`MenuPage`), and the order chunk when checkout mounts, so a tap rarely waits on a download. Why: the `/` first-load budget (Batch 1 §10.5); it is Batch 7 §6.2 fix 3, applied early. Measured with `env -u NODE_ENV pnpm build`: the entry chunk is 123.68 KB gzipped (no modulepreload links), and the checkout chunk 8.77 KB, the order chunk 2.47 KB and the track chunk 1.62 KB, each gzipped. **Measure budgets with `NODE_ENV` unset**: development's `NODE_ENV` makes Vite ship React's development build, which is much larger.
- Tests: `tests/integration/{orders.create,orders.concurrency,orders.lookup,inventory}.test.ts`, `tests/unit/{stock-writes-guard,uuid,order-fingerprint,public-order-view,lookup-schema,db-errors,submit-order,submit-errors,recent-orders,order-markup}.test.ts`, additions to `cart.test.ts`, `checkout-markup.test.ts` and `use-menu.test.ts`, `tests/helpers/{invariant,order-fixtures}.ts` (and small additions to `app.ts`, `clock.ts`, `markup.ts`).

## 15. Commands

```bash
pnpm db:seed
pnpm dev
pnpm test                                   # includes the concurrency tests
pnpm vitest run tests/integration/orders    # just the order tests
pnpm lint && pnpm typecheck
```
