# Batch 6 — Vendor dashboard, batch grouping and admin management

| | |
|---|---|
| Status | Not started |
| Depends on | Batch 5 (orders, `inventory.service`) |
| Brief sections | §2 vendor 1–6, §3 admin COD, §5 slot config, §6 grouping, §7 + §9 express view and switch, §11 emergency controls, §14 stock screen and cancel restore, §16 Order status, §17 Vendor dashboard, §18 Admin menu management, §19 Delivery configuration, §30 vendor questions |
| Endpoints | every `/api/admin/*` route in Batch 1 §8.3 except auth |
| Rules used | Batch 1 §6.3–§6.10 (esp. L1–L5, S3, S5, B5–B8, E4–E5), §8.5 |

## 1. Goal

Bunty runs the whole day from his phone in a couple of minutes:

- **Morning:** set today's stock in about 30 seconds.
- **During the day:** one glance at **Today** answers the brief's two questions: *"How many orders, and how many of each item, for MSH at 8 PM?"* and *"Which orders need to go out separately right now?"*
- **Delivery:** finish a whole batch, cash collected, in one confirmed tap; finish an express order in two.
- **Any time:** pause express or all orders in one tap; fix mis-taps (reopen, undo cash); cancel a prank order and get the food back into stock.

The dashboard stays extremely simple: no POS, no kitchen workflow (brief §2).

## 2. Scope

**In:** `status-machine.ts`, `dashboard.service.ts`, admin order queries, `settings.service.ts`, location/slot/menu admin services, all remaining admin routes and strict admin schemas, and the admin UI: shell, **Today**, **Orders** (search, list, detail), **Stock**, **Menu**, **Settings**, polling, new-order alerts, confirm dialogs.

**Out:** printing, CSV export, push notifications, analytics, multiple admins, customer messaging.

## 3. The vendor's day (design target)

| Moment | Screen | Taps |
|---|---|---|
| 10:00 set up the day | Stock → "Use yesterday's numbers" → adjust two items → Save | ~5 |
| All day | Today auto-refreshes every 20 s; new orders highlighted; optional sound | 0 |
| A customer calls about BB1023 | Search icon → type `1023` → order detail → Call / Cancel | ~3 |
| 19:30 MSH cutoff | Today → MSH card shows "4 orders · 9 items · ₹1,340 COD" and "Chicken Biryani ×8 · Paneer Biryani ×1" → pack | 0 |
| 20:00 MSH delivered | MSH card → "Mark all completed" → confirm (cash collected ticked) | 2 |
| Express order delivered | Express card → "Cash collected" → "Completed" | 2 |
| Rice runs out | Today → Express switch off, or the slot's "Close for today" | 1–2 |
| Prank order | Order → Cancel → confirm | 2 |

## 4. `status-machine.ts`

```ts
type OrderAction =
  | { status: 'COMPLETED' | 'ORDER_RECEIVED' | 'CANCELLED' }
  | { paymentStatus: 'COLLECTED' | 'PENDING' };

canApply(order: { status; paymentStatus }, action): 'APPLY' | 'NOOP' | 'INVALID'
applyOrderAction(tx, orderId: number, action: OrderAction, now: Date): Promise<OrderWithItems>
```

`applyOrderAction`:

1. `SELECT id, status, payment_status, delivery_date FROM orders WHERE id = ${orderId} FOR UPDATE` → none: `NOT_FOUND`.
2. `canApply` → `NOOP`: return the order unchanged (Batch 1 L5). `INVALID`: throw `INVALID_TRANSITION` with `{ from, to }`.
3. Side effects:
   - → `COMPLETED`: `completedAt = now`;
   - → `ORDER_RECEIVED` (reopen): `completedAt = null`;
   - → `CANCELLED`: load items; `inventory.restoreStockForOrder(tx, { deliveryDate, items })`; `cancelledAt = now`;
   - → `COLLECTED`: `collectedAt = now`;
   - → `PENDING`: `collectedAt = null`.
4. Update and return the order with items.

Transition table (`canApply`), rows = current state, columns = action:

| status / payment | →COMPLETED | →ORDER_RECEIVED | →CANCELLED | →COLLECTED | →PENDING |
|---|---|---|---|---|---|
| ORDER_RECEIVED / PENDING | APPLY | NOOP | APPLY | APPLY | NOOP |
| ORDER_RECEIVED / COLLECTED | APPLY | NOOP | INVALID | NOOP | APPLY |
| COMPLETED / PENDING | NOOP | APPLY | INVALID | APPLY | NOOP |
| COMPLETED / COLLECTED | NOOP | APPLY | INVALID | NOOP | APPLY |
| CANCELLED / PENDING | INVALID | INVALID | NOOP | INVALID | NOOP |

`CANCELLED / COLLECTED` cannot exist (database check, Batch 1 §7.3).

Every caller (single update, complete-many) runs inside `prisma.$transaction`. Nothing else in the codebase changes `status`, `paymentStatus`, `completedAt`, `cancelledAt` or `collectedAt`. Batch 7 adds this to the stock-writes guard pattern.

## 5. Dashboard service

`getDashboard(prisma, clock, date?)` → contract in Batch 1 §8.5.

Queries (for `D = date ?? today`), run in parallel:

1. settings;
2. if `D` is today: active slots with location;
3. orders with `deliveryDate = D`, all statuses, with items;
4. if `D` is today: express orders with `status = ORDER_RECEIVED` and `deliveryDate < D`;
5. if `D` is today: batch orders with `status = ORDER_RECEIVED` and `deliveryDate < D` (`earlierOpenOrders`);
6. if `D` is today: count of active + available items with `stockDate ≠ today` (or null).

Grouping:

```
groups = ordered map keyed by (slotId, slotDeliveryTime)
if D is today: add an empty group for every active slot, keyed (slot.id, slot.deliveryTime)
for each BATCH order of D: add to group (order.slotId, order.slotDeliveryTime), creating it if needed
for each group:
  counted       = orders where status ≠ CANCELLED
  orderCount    = counted.length
  openCount     = orders where status = ORDER_RECEIVED
  itemCount     = Σ quantity over counted
  codTotal      = Σ total over counted
  codPending    = Σ total over counted where paymentStatus = PENDING
  itemBreakdown = quantities merged by menuItemId (name from the snapshot), largest first
  slotTimeChanged = slotDeliveryTime ≠ the slot's current deliveryTime
  orders sorted: ORDER_RECEIVED by createdAt ↑, then COMPLETED by createdAt ↑, then CANCELLED
groups sorted by deliveryTime ↑, then location sortOrder ↑
```

- Slot fields for a group (`cutoffTime`, `isOpenNow`, `closedToday`) come from the current slot row via `slotStatus` (Batch 4 §3).
- Express list: active express orders from earlier days (query 4) + all express orders of `D`, sorted: `ORDER_RECEIVED` by `createdAt` ↑, then `COMPLETED` by `createdAt` ↓, then `CANCELLED`. `isLate` per Batch 1 E5 using the clock.
- Summary: `newOrders` = `ORDER_RECEIVED` of `D` (both modes); `completed`, `cancelled` counts; `codPending` and `codCollected` over non-cancelled orders of `D`.

A day is at most a few hundred rows, all on indexed `delivery_date`; this is computed in memory per request.

## 6. Admin services, routes and schemas

All routes sit behind `requireAdmin`; writes also pass `originCheck`. Schemas live in `src/shared/schemas/admin.ts` and are **strict** (unknown keys rejected), so a stock field can never slip through a menu update.

| Schema | Rules |
|---|---|
| `dashboardQuerySchema` | `date?` `YYYY-MM-DD`, not after today |
| `ordersQuerySchema` | `date?`, `mode?` (`BATCH`/`EXPRESS`), `status?`, `slotId?`, `q?` (≤ 20 chars) |
| `orderActionSchema` | union of `{ status }` and `{ paymentStatus }`, each strict, so exactly one key |
| `completeManySchema` | `orderIds`: 1–200 positive ints, unique; `markCollected`: boolean |
| `menuItemCreateSchema` | `name` trimmed 2–60; `description` ≤ 200, empty → null; `price` int 1–10000; `imageUrl` `https://` URL ≤ 500 or null; `isAvailable` default true |
| `menuItemUpdateSchema` | partial of create + `sortOrder` int 0–9999; at least one key |
| `stockBulkSchema` | `items`: 1–100 of `{ menuItemId, stock: int 0–10000 }`, unique ids |
| `locationCreateSchema` / `locationUpdateSchema` | `name` trimmed 2–40; `isActive`; `sortOrder` |
| `slotCreateSchema` / `slotUpdateSchema` | `locationId`; `deliveryTime`, `cutoffTime` `HH:mm`; `isActive`; `closedToday` (update only); `cutoffTime < deliveryTime` on the create body or, for updates, on the merged row (checked in the service) |
| `settingsUpdateSchema` | Batch 1 §8.5 ranges; merged-row checks for ETA min ≤ max and opens < closes in the service |

Service notes:

- **Orders search `q`:** `^(bb)?\d+$`i → order number `BB<digits>`; any 4–10 digit string also matches phones ending in those digits (`OR`). `q` ignores `date`.
- **complete-many:** ids sorted ascending; for each, `applyOrderAction({ status: 'COMPLETED' })`, then `{ paymentStatus: 'COLLECTED' }` if asked; one transaction; returns counts of actual changes.
- **Menu create:** `sortOrder` = current max + 1, so new items appear last; no stock (`stockDate` null).
- **Menu delete:** `isActive = false`. Past orders keep their snapshots.
- **Stock:** `PUT /api/admin/stock` → `inventory.setTodayStock` inside a transaction. **(as built, Batch 5)** It returns `StockRow[]` (`{ id, dailyStock, stockRemaining, stockDate }`), not an admin view; this service re-reads or maps those rows into the `AdminMenuItem` shape the Stock screen needs (the type is defined in Batch 6, not before).
- **Locations:** names are unique case-insensitively (checked in the service before insert/rename, plus the database unique index). Deactivation is allowed; the UI warns how many active slots it hides.
- **Slots:** a unique violation → `409 DUPLICATE` (`field: deliveryTime`); `closedToday: true` → `closedOn = today`, `false` → `null`; `openOrdersToday` in the list = today's `ORDER_RECEIVED` orders on that slot.
- **Settings:** `PATCH` merges with the current row and validates the merged result before writing.

## 7. Admin UI

### 7.1 Shell

- Top bar: logo + "BBC ADMIN" (Archivo), search icon → `/admin/orders`, overflow menu with **Log out**.
- Bottom tabs (56 px + safe area): **Today**, **Stock**, **Menu**, **Settings**. Active tab in brand red with a label (not icon only).
- Same tokens as the customer app; admin text may be denser (14 px secondary), but every target stays ≥ 48 px.
- Pages scroll under the fixed bars; content gets matching top and bottom padding.

### 7.2 Today (`/admin`)

```
BBC ADMIN                              🔍  ⋮
───────────────────────────────────────────
TODAY · Sun, 4 Oct        ‹  ›   Updated 12 s ago ⟳
┌───────────────────┐ ┌───────────────────┐
│ ORDERS     [● ON] │ │ EXPRESS    [● ON] │
│ Open              │ │ On · till 11:00 PM│
└───────────────────┘ └───────────────────┘
⚠ 2 items have no stock today. Customers see them as sold out.  Set stock ›

NEW ORDERS: 7            ₹2,240 COD pending

BATCH DELIVERY
┌─────────────────────────────────────────┐
│ MSH — 8:00 PM          Open till 7:30 PM│
│ 4 orders · 9 items · ₹1,340 COD         │
│ Chicken Biryani ×8 · Paneer Biryani ×1  │
│ [ Show 4 orders ▾ ]   [ Mark all done ] │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Kanhar — 8:45 PM              No orders │
└─────────────────────────────────────────┘

EXPRESS · 2 active
┌─────────────────────────────────────────┐
│ BB1031 · Rahul · Kanhar        ⚠ LATE   │
│ Room 214, B block                        │
│ Chicken Biryani ×2                       │
│ ₹330 COD · Pending                       │
│ Ordered 7:10 PM · deliver approx.        │
│ 7:40–7:50 PM                             │
│ [ Call ]  [ Cash collected ] [ Done ]    │
└─────────────────────────────────────────┘
Completed today (3) ▸
```

**Header row:** "TODAY · Sun, 4 Oct", previous/next day arrows (`?date=`; next is disabled on today), "Updated 12 s ago" from the last successful fetch, and a manual refresh button.

**Emergency controls** (brief §11), always at the top:

- **Orders** switch: On = "Open", Off = "Paused". Turning it off asks: "Pause all orders? Customers can't order until you turn this back on." [Keep open] [Pause orders]. Turning it on needs no confirmation.
- **Express** switch: no confirmation either way. Subtext: "On · till 11:00 PM", "On · opens 11:00 AM" (outside hours) or "Off".
- Both call `PATCH /api/admin/settings` and show the server's result. While paused, a full-width warning strip says "Orders are paused" so it can't be forgotten.

**Banners** (today only):

- Stock warning when `itemsWithoutStockToday > 0` → link to Stock.
- "Open orders from earlier days (2)" (info) → expands `earlierOpenOrders` as order rows.

**Summary:** "NEW ORDERS: 7" (Archivo) and "₹2,240 COD pending".

**Batch cards** (brief §17):

- Title "MSH — 8:00 PM" (Archivo). Status chip: "Open till 7:30 PM" (success), "Closed for orders" (neutral, after cutoff), "Closed today" (warning).
- `slotTimeChanged`: subtitle "Slot time changed to 8:15 PM. These customers were told 8:00 PM."
- Count line: "4 orders · 9 items · ₹1,340 COD".
- **Item breakdown** in 16 px semibold: the packing list, the most important line on the card.
- "Show 4 orders" expands the order rows (§7.3); collapsed by default so the screen stays short.
- **Mark all done** (when `openCount > 0`): a confirm sheet "Mark 3 open orders at MSH — 8:00 PM as completed?" with a checkbox "Cash collected for all" (ticked by default) → `POST /api/admin/orders/complete-many` with the **open order ids currently shown**.
- Overflow on the card: "Close for today" / "Reopen for today" (`PATCH` slot `closedToday`).
- A slot with no orders shows a single line: "Kanhar — 8:45 PM · No orders yet" plus its status chip.

**Express section** (brief §17):

- Heading "EXPRESS · 2 active".
- One card per active order: number, name, location; room/address; items; total + COD status; "Ordered 7:10 PM · deliver approx. 7:40–7:50 PM"; a **LATE** chip (danger-soft + icon) when `isLate`.
- Actions: **Call** (`tel:` link), **Cash collected** (toggle), **Done** (complete). Overflow: Cancel.
- Completed and cancelled express orders of the day sit under a collapsed "Completed today (3)".

### 7.3 Order row (batch card, express card, search results)

- Line 1: "BB1023 · Rahul Verma" + chips (NEW, COD Pending/Collected, Completed/Cancelled).
- Line 2: items inline, "Chicken Biryani ×2, Raita ×1".
- Line 3: room/address (if any) and total.
- Actions: **Call**, **Cash collected** ⇄ **Undo cash**, **Done** ⇄ **Reopen**, overflow → **Cancel order**, **Open details**.
- After Done or Cash collected, an inline "Undo" link shows for 5 s (it sends the reverse action).
- **Cancel** dialog: "Cancel order BB1023?" / "Rahul Verma · ₹320. Items go back into today's stock. This can't be undone." [Keep order] [Cancel order] (danger button). For an order from an earlier day the text says "Stock isn't restored for orders from earlier days." If cash is collected, Cancel is disabled with "Undo cash collected first."
- Completed rows use muted text and a "Completed" chip (no opacity). Cancelled rows show a "Cancelled" chip, are listed last and are excluded from all totals.
- Each action shows a spinner on its button and refreshes the dashboard on success. On failure: danger banner with the server message; nothing changes locally.

### 7.4 New-order alerts

- SWR on the dashboard: `refreshInterval: 20_000`, `revalidateOnFocus: true`, no polling while the tab is hidden; it refreshes on return.
- New order ids since the previous fetch get a "NEW" chip and a gold-soft background until tapped or for 2 minutes; `document.title` becomes "(3) BBC Admin".
- **Sound** (opt-in, Settings, stored per device in `localStorage['bbc.admin.sound']`): a short bundled sound (≤ 10 KB, in the admin chunk) plus `navigator.vibrate(200)`. Browsers block audio until the user interacts, so if `play()` is rejected, show a chip "Tap to enable sound alerts".
- **Stale data warning:** if a refresh fails while data is shown, a warning strip says "Can't reach the server. Showing orders from 7:12 PM." The vendor must never mistake stale data for live data.

### 7.5 Orders (`/admin/orders`, `/admin/orders/:id`)

- Search field (auto-focused): "Order ID or phone number". Filter chips: All / Batch / Express; Open / Completed / Cancelled; date selector (default today).
- Results use the order row (§7.3); tapping one opens the detail.
- Detail page: every field from the admin order view, IST-formatted timestamps (placed, completed, cash collected, cancelled), Call and Copy phone, the same actions and rules.

### 7.6 Stock (`/admin/stock`)

```
TODAY'S STOCK · Sun, 4 Oct
[ Use yesterday's numbers ]

Chicken Biryani        Sold 22 · Left 8     [ 30 ]
Paneer Biryani         Not set today         [    ]  last: 20
Raita                  Sold 0 · Left 40      [ 40 ]
Hidden from menu
Gulab Jamun            Not set today         [    ]

            [        Save stock        ]   (sticky)
```

- All active items; hidden (`isAvailable = false`) ones last, under "Hidden from menu".
- Each row: name, today's status ("Sold 22 · Left 8" or "Not set today"), and a number input labelled "Total for today" (`inputmode="numeric"`, min 0). Helper on focus: "Sold 22 so far. Total can't be less than 22."
- **Use yesterday's numbers:** fills every empty "Not set today" input with that item's last `dailyStock`.
- **Save** sends only changed rows plus filled "Not set today" rows to `PUT /api/admin/stock`. Empty "Not set today" rows stay unset, so those items remain sold out.
- Client checks: integer 0–10000, ≥ sold. Server `STOCK_BELOW_SOLD` errors are mapped onto their rows.
- Success: banner "Stock saved. Customers can order these items now."
- Leaving with unsaved changes asks: "Discard your stock changes?"

### 7.7 Menu (`/admin/menu`)

- List: name, price, an **On menu** switch (`isAvailable`, saved immediately), up/down buttons to reorder (`sortOrder`; no drag-and-drop library), tap a row to edit.
- **Add item** → form: Name, Description (optional), Price (₹, numeric), Image link (optional, `https://` only, with a small preview), On menu (switch). Save → `POST`. After creating: "Item added. Set today's stock so customers can order it." with a link to Stock.
- **Edit** → same form. Under Price: "New prices apply to new orders only." **Delete item** (danger) → "Delete Chicken Biryani? It disappears from the menu. Past orders keep it." [Keep] [Delete].
- Empty state: "No menu items yet." [Add your first item].

### 7.8 Settings (`/admin/delivery`, tab label "Settings")

Sections; switches save immediately, other sections have their own Save button:

1. **Ordering:** Orders open/paused and Express on/off (the same switches as Today).
2. **Express:** fee (₹), ETA min and max minutes (preview: "Customers see: Delivered in approximately 30–40 minutes"), hours "Opens" / "Closes" (`<input type="time" step="60">`, whose value is always `HH:mm` 24 h).
3. **Batch:** fee (₹, 0 shows "Free" to customers).
4. **Locations:** list with Active switch and rename; **Add location**. Deactivating a location that has active slots warns: "MSH has 1 active slot. Customers won't see it while MSH is off."
5. **Batch slots:** grouped by location: "8:00 PM · order by 7:30 PM" with **Active** and **Closed today** switches and Edit. Editing a slot with `openOrdersToday > 0` warns: "3 customers were told 8:00 PM. The new time applies to new orders only." **Add slot**: location, delivery time, cutoff time; inline error "Cutoff must be before the delivery time." Slots can't cross midnight.
6. **Customer help number:** mobile number shown on confirmation pages, or empty.
7. **This device:** sound alerts on/off.
8. **Account:** Log out. Note: "Lost your phone? Reset the password from the server (admin:reset-password) to log out every device."

### 7.9 States and copy

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Today | skeleton controls + 2 skeleton cards | "No orders yet today." (batch cards still list the slots) | `ErrorState` "Couldn't load today's orders." [Try again] |
| Express section | — | "No express orders right now." | — |
| Orders search | skeleton rows | "No orders match." | `ErrorState` |
| Stock | skeleton rows | "No menu items yet. Add items in Menu first." | `ErrorState` |
| Menu | skeleton rows | "No menu items yet." [Add your first item] | `ErrorState` |
| Settings | skeleton sections | "No locations yet. Add one to start taking orders." | `ErrorState` |

Server error codes map to the server's `message`, shown in a danger banner with an icon. Copy lives in `copy.ts` under `admin.*`.

## 8. Edge cases

| Case | Handling |
|---|---|
| Vendor on phone and laptop at once | Status machine locks the row; same-state requests are no-ops; both screens converge on the next poll. |
| Double tap on Done | Second request is a no-op. |
| Cancel tapped twice / on two devices | First cancels and restores stock; second is a no-op; stock restored once (tested). |
| Cancelling yesterday's order | Allowed; stock not restored (S5); dialog says so. |
| New order lands in MSH between the vendor's last refresh and "Mark all done" | Only the ids shown are completed; the new order stays open and appears highlighted on the next poll. |
| Slot time edited with open orders | Old orders keep their time and form their own group with a "slot time changed" note. |
| Location renamed or deactivated mid-day | Today's groups still render from order snapshots. |
| Item deleted after orders | Breakdown and orders show the snapshot name. |
| Midnight with the dashboard open | Without `?date`, the next poll shows the new day; open express orders from yesterday stay in the express list; open batch orders appear under "earlier days". |
| Viewing a past date | Controls still work (they're global); only slots with orders are shown; no "close for today". |
| Session expires | Redirect to login with `next`; after login, back to the same screen. |
| Network drops | Stale-data warning strip; actions fail with a banner and change nothing. |
| 200 orders in a day | Cards collapsed by default; one request; no pagination needed. |
| Vendor sets stock lower than sold | Row error "Already sold 22 today. Enter 22 or more." |

## 9. Tests

All integration tests run against real Postgres with the inventory invariant asserted after each test.

### 9.1 Unit

1. `canApply`: every cell of the §4 table.
2. Grouping function (pure, fed fixtures): brief §6 scenario; cancelled excluded from counts but listed last; completed counted but not open; zero-order slot present for today and absent for a past date; changed slot time → two groups with `slotTimeChanged`; breakdown merges by `menuItemId` and sorts largest first.
3. Orders search `q` parser: `BB1023`, `bb1023`, `1023`, `98765` and `9876543210` map to the right conditions.

### 9.2 Integration — access control (`tests/integration/admin.access.test.ts`)

4. Table-driven over every admin route except login: no cookie → `401`.
5. Every admin write with `Origin: https://evil.example` (valid cookie) → `403`; same with no `Origin` → `403`.

### 9.3 Integration — dashboard (`tests/integration/admin.dashboard.test.ts`)

6. **Brief §6:** three customers order MSH 8:00 PM at 14:00, 17:00 and 18:30 IST (clock moved between orders) → one MSH group, `orderCount: 3`, three separate order rows, correct `itemCount`, `codTotal`, breakdown.
7. **Brief §17 numbers:** fixtures that produce "MSH — 4 orders · 9 items · ₹1,340" and "Kanhar — 3 orders · 6 items · ₹900"; `newOrders: 7`; `express.activeCount: 2`.
8. A cancelled order is in `orders` but not in any count or total.
9. A completed order counts in `orderCount` but not `openCount`; `codPending` vs `codCollected` split correctly.
10. Express orders never appear in batch groups; express window `19:40`–`19:50` for a 19:10 order; `isLate` false at 19:45, true at 19:51.
11. An active express order from yesterday appears in today's `express.orders`; an open batch order from yesterday is in `earlierOpenOrders`.
12. Slot time changed after two orders, then one more order → two groups, the older one with `slotTimeChanged: true`.
13. `stock.itemsWithoutStockToday` counts items stocked yesterday or never.
14. `?date=` yesterday → that day's groups only; no empty slot groups; `earlierOpenOrders` empty.
15. Future `date` → `400`.

### 9.4 Integration — order actions (`tests/integration/admin.orders.test.ts`)

16. Complete → `completedAt` set; reopen → cleared; collect → `collectedAt` set; undo → cleared.
17. Cancel → `CANCELLED`, `cancelledAt` set, stock restored, public menu `maxQty` back up.
18. Cancel while `COLLECTED` → `409 INVALID_TRANSITION`; complete / collect a cancelled order → `409`.
19. Cancel twice in sequence → second is a no-op; cancel twice concurrently (`Promise.all`) → stock restored exactly once.
20. Cancel yesterday's order after today's stock was set → stock unchanged.
21. `complete-many` with three of four open ids + `markCollected` → those three completed and collected; the fourth untouched; an unknown id in the list → `404` and nothing changed; a cancelled id → `409` and nothing changed.
22. Search: `q=BB1001`, `q=1001`, `q=<last 5 digits of phone>` each find the order; filters by mode and status work.

### 9.5 Integration — management (`tests/integration/admin.manage.test.ts`)

23. Menu: create (sortOrder last, no stock); `price: 0` → `400`; `imageUrl: "http://…"` → `400`; body with `stockRemaining` → `400`; patch price → public menu shows the new price, past order lookup shows the old one; delete → gone from public and admin menu, past order intact.
24. Stock endpoint: success returns updated rows; below sold → `409 STOCK_BELOW_SOLD` listing the item; no change on error.
25. Locations: create; duplicate in different case → `409 DUPLICATE`; deactivate → its slots vanish from `/api/delivery-options` and express locations.
26. Slots: create; cutoff ≥ delivery → `400`; duplicate time at a location → `409`; patch making the merged row invalid → `400`; `closedToday: true` → `CLOSED_TODAY` publicly; with the clock on the next day → open again; `openOrdersToday` counts open orders only.
27. Settings: patch fee → `/api/delivery-options` shows it; ETA min > max on the merged row → `400`; opens ≥ closes → `400`; bad `contactPhone` → `400`; `ordersPaused: true` → public menu flag and `POST /api/orders` → `ORDERS_PAUSED`.

### 9.6 Manual: a day in the life (real phone, `pnpm dev` over LAN)

1. Morning: Stock → Use yesterday's numbers → Save. The customer menu shows the items.
2. Place five orders from another phone (three MSH, one Kanhar, one express); each appears within 20 s with NEW, sound on.
3. MSH card answers "how many of each item"; express card shows the window; wait past it → LATE.
4. Mark all done at MSH with cash collected; undo one; complete the express order.
5. Cancel a Kanhar order → the customer menu stock goes back up.
6. Pause all → the customer sees the paused banner; resume.
7. Edit the MSH slot time with open orders → warning, then two groups.

## 10. Definition of done

- [ ] Status changes go only through `status-machine.ts`; the table in §4 is unit-tested cell by cell.
- [ ] The dashboard answers the brief §30 questions at a glance (owner confirms on a phone).
- [ ] Every admin endpoint in Batch 1 §8.3 exists with strict schemas and the access tests pass.
- [ ] All tests in §9 pass with the invariant after each; the concurrency tests from Batch 5 still pass.
- [ ] The manual day in §9.6 completed on a real phone.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; `CLAUDE.md` batch table updated.

## 11. Files

- Server: `src/server/services/{status-machine,dashboard.service,settings.service,admin-orders.service,admin-menu.service,locations.service,slots.service}.ts`, `src/server/routes/admin/{dashboard,orders,menu,stock,locations,slots,settings}.ts`.
- Shared: `src/shared/schemas/admin.ts`, additions to `api-types.ts`.
- Client: `src/client/features/admin/{layout,today,orders,stock,menu,delivery}/**`, `src/client/components/{Switch,ConfirmDialog,Chip}.tsx`, `src/client/features/admin/assets/new-order.mp3`, `copy.ts` additions.
- Tests: `tests/unit/{status-machine,dashboard-grouping,orders-query}.test.ts`, `tests/integration/admin.{access,dashboard,orders,manage}.test.ts`.

## 12. Commands

```bash
pnpm db:seed
pnpm admin:create          # if not done yet
pnpm dev                   # admin at http://localhost:5173/admin
pnpm dev:client --host     # to try it from a phone on the same Wi-Fi (set DEV_ALLOWED_ORIGINS)
pnpm test
pnpm lint && pnpm typecheck
```
