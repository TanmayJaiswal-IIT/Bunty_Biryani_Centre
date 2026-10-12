# Batch 7 — Testing + mobile polish

| | |
|---|---|
| Status | Not started |
| Depends on | Batches 2–6 |
| Brief sections | §24 Mobile-first design, §29 Testing checklist, §30 Definition of done (verified locally) |
| Endpoints | none new |
| Rules used | Batch 1 §10.4–§10.5, §12 |

## 1. Goal

Before anything is deployed, prove locally that every item in the brief's testing checklist (§29) passes, and that the §30 definition of done holds on real phones. Make the app feel fast and solid on a mid-range Android phone on mobile data, and get the owner's sign-off on every word customers and the vendor will read.

No new features in this batch. Anything found missing goes back to its batch spec as a fix, not a new feature.

## 2. Scope

**In:** a traceability matrix from brief §29 to tests; Playwright e2e for customer and vendor journeys; filling test gaps; the bundle-size check; Lighthouse; an accessibility pass; the mobile polish list; web app manifest and icons; error boundary and offline banner; a copy review with the owner; a pre-deploy security review; CI on GitHub Actions; an owner acceptance session.

**Out:** deployment (Batch 8), new features, visual redesign.

## 3. Brief §29 traceability

Every checklist item maps to at least one automated test or a named manual step. "B5 #23" means test 23 in Batch 5's test section. Batches 2–4 restart numbering per subsection, so their ids name the subsection ("B4 #13.4-1" = Batch 4 §13.4, test 1; "B3 unit 1" = Batch 3 §11.2, test 1). E2E ids are defined in §5.

| Brief §29 item | Covered by |
|---|---|
| **Customer** menu loads | B3 #11.1-1…9, E2E C1 |
| add to cart / quantity changes | B3 unit 1–3, E2E C1 |
| checkout | E2E C1, C2 |
| batch selection | B4 #13.4-1, E2E C1 |
| express selection | E2E C2 |
| ₹30 fee correct | B5 #2, E2E C2 |
| COD shown | E2E C1, C2 (assert "CASH ON DELIVERY" at checkout and confirmation) |
| order created / order ID generated | B5 #1, #3, E2E C1 |
| confirmation shown | E2E C1 (and after reload) |
| lookup works only with correct phone | B5 #26–28, E2E C5 |
| double tap doesn't create two orders | B5 #20–22, E2E C6 |
| **Batch** MSH 8:00 PM and Kanhar 8:45 PM appear | B4 #13.4-1, E2E C1 |
| cutoff works (server time) | B4 #13.1-1, B5 #7, E2E C3 |
| multiple orders group correctly | B6 #6, E2E V1 |
| vendor sees order/item counts, totals, breakdown | B6 #7, E2E V1 |
| **Express** on/off works | B5 #11, B6 #27, E2E V4 |
| ₹30 added | B5 #2 |
| doesn't join batch / shown separately | B6 #10, E2E V1 |
| 30–40 min expectation shown | E2E C2 |
| delivery window shown to vendor | B6 #10, E2E V1 |
| **Inventory** stock decreases | B5 #1 |
| can't oversell (incl. two simultaneous orders for the last item) | B5 #23–24 |
| sold-out items blocked | B5 #15–16, E2E C4 |
| cancel restores stock | B6 #17, E2E V3 |
| **Admin** login | B2 #12.3-4, E2E V5 |
| protected routes return 401 without cookie | B6 #4 |
| see new orders, COD, customer info, delivery mode, location/time | E2E V1 |
| edit menu and stock | B6 #23–24, E2E V2 |
| configure slots | B6 #26 |
| pause express / pause all | B6 #27, E2E V4 |
| mark completed / COD collected / cancel | B6 #16–21, E2E V3 |
| **Mobile** Android Chrome | Manual M1 |
| responsive / no horizontal scroll | E2E: every page at 360 and 412 px asserts `scrollWidth <= clientWidth`; Manual M1 |
| fast on a normal connection | §6 budgets, Lighthouse, Manual M2 |

Add a test anywhere the matrix finds a gap, in the batch-owned file.

## 4. Playwright setup

- `@playwright/test` (approved in Batch 1 §4), Chromium only. Projects: `mobile-360` (360×740, `isMobile`, `hasTouch`, device scale factor 3) and `mobile-412` (Pixel 7 descriptor).
- `webServer`: `pnpm build` once, then `node --env-file=.env.e2e dist/node/src/server/index.js` on port 3100. The built app is served by Express, as in production (Batch 2 §6.5).
- `.env.e2e` (committed, no secrets): `NODE_ENV=test`, `DATABASE_URL` → `bbc_e2e` database, `APP_ORIGIN=http://localhost:3100`, `PORT=3100`, a throwaway `JWT_SECRET`, `CLOCK_OVERRIDE=2026-10-04T13:40:00Z` (19:10 IST; time moves forward from there).
- `globalSetup`: reset `bbc_e2e` with `resetSchema()` from `tests/helpers/reset-schema.ts` (drops the schema and runs `prisma migrate deploy`; Batch 2 §12.1), then `seed-initial`, the e2e fixture menu (A Chicken Biryani ₹150, B Paneer Biryani ₹130, C Raita ₹20, D Egg Biryani ₹120) stocked for **2026-10-04**, and an admin `e2e-admin` with a known password.
- `tests/e2e/helpers/db.ts` talks to `bbc_e2e` directly (Prisma) to arrange state: reset orders and stock, set a slot's cutoff, toggle settings, change a price, count orders. Times are arranged relative to the server clock (e.g. MSH cutoff `19:00` makes it already closed).
- `workers: 1` (one shared database); `beforeEach` resets orders and stock.
- Every test: fails on any browser console error (including CSP violations) and checks for no horizontal scroll on each page it visits.
- Selectors use roles and visible text (`getByRole`, `getByText` from `copy.ts`), not CSS classes.

## 5. E2E scenarios

### Customer

| Id | Scenario | Key assertions |
|---|---|---|
| C1 | Batch order | Add 2 × A and 1 × C; cart bar "3 items · ₹320"; Checkout; Batch; "MSH — 8:00 PM" and "Kanhar — 8:45 PM" listed; pick MSH; enter name and phone; summary "Free", "₹320", "CASH ON DELIVERY"; Place order → "ORDER PLACED", `BB1001`, "MSH", "8:00 PM", "₹320"; reload → still shown. |
| C2 | Express order | Express, Kanhar; summary +₹30 = ₹330; "approximately 30–40 minutes"; confirmation shows "Approx. 30–40 minutes" and a window matching `/\d{1,2}:\d{2}–\d{1,2}:\d{2} (AM\|PM)/`. |
| C3 | Cutoff → express | Helper sets MSH cutoff 19:00; MSH slot shows "Orders for this delivery slot are closed." and "Batch orders for MSH are closed. Express delivery is available."; Try Express Delivery → Express + MSH selected; order succeeds as express. |
| C4 | Sold out | D stock 0 → listed under Sold out, no Add button. C stock 1 → add 1; helper sells it; Place order → "Raita just sold out and was removed." and the cart updates. |
| C5 | Lookup | `/track` with wrong phone → "We couldn't find an order with that ID and mobile number."; correct phone → order page. |
| C6 | Double submit | Delay `POST /api/orders` by 2 s (`page.route`); double-click Place order → one order in the database; confirmation shown. |
| C7 | Paused | Helper pauses orders → menu banner; cart bar "Orders are paused"; checkout button disabled. |
| C8 | Price changed | Open checkout; helper raises A's price; Place order → "Prices changed…" banner and the new total; Place order again → success at the new price. |
| C9 | Network failure | Abort the first `POST /api/orders` (`route.abort`) → "We couldn't confirm your order…"; Try again → one order. |
| C10 | Network error, then Try again (as built, Batch 5) | Let the first `POST /api/orders` reach the server but drop the response (`route.fetch` then `route.abort`); change the price before Try again → the confirmation shows the **original** total and the database holds exactly one order (Batch 5 runbook P5b). Also Try again while orders are paused → still the confirmation. |
| C11 | Double tap, hard | Tap Place order twice and press Enter on the focused button, with `POST /api/orders` delayed → one request or one order; the button shows "Placing order…" and `aria-busy`. (C6 covers a double-click; this adds keyboard and rapid repeats.) |
| C12 | After success: navigation and Back | After the confirmation, Back goes to the menu with an empty cart (not a stale checkout, not a blank page); the checkout skeleton, not a blank screen, shows during the hand-off. Forward and reload keep the order. |
| C13 | Track form submit paths | On `/track` and on the order page's inline fallback: submit with Enter and with the button; a bad ID or phone shows field errors and focus; a wrong pair shows the not-found banner; a 429 shows the rate-limit copy; a correct pair opens the order and adds it to "Orders on this phone". |
| C14 | Order-page refresh | Reload `/order/BB1001` and open it from a stale history entry: it revalidates on mount; mark the order `CANCELLED` in the database, wait for the 60 s refresh (or refocus the tab) → the cancelled banner replaces "ORDER PLACED"; for a `COMPLETED` order the refresh stops. |
| C15 | Chunk-load failure | Make the checkout chunk (`/assets/CheckoutPage-*.js`) fail with `route.abort` → the route-load error state with a reload action, not a blank page; remove the abort and reload → checkout loads. Same for the order chunk. |
| C16 | Candidate (not in §14): Try again survives a reload | Only if the frozen request (Batch 5 §7.2) is persisted in `sessionStorage` across a reload or tab discard: drop the first response, reload `/checkout` → the button still reads "Try again"; tapping it opens the original order; exactly one order in the database. |

### Vendor

| Id | Scenario | Key assertions |
|---|---|---|
| V1 | Sees orders | Helper places 2 MSH orders and 1 express via the API; log in; Today shows "MSH — 8:00 PM", "2 orders", the item breakdown, COD totals; Express card shows customer name, phone, location, "Ordered … · deliver approx. …"; Kanhar "No orders yet". |
| V2 | Stock and menu | Stock: set B to 5, Save → customer menu can add B. Menu: add "Veg Biryani ₹110" → hidden from customers until stock is set; set stock → visible; switch "On menu" off → hidden. |
| V3 | Actions | MSH → Mark all done with cash collected → chips "Completed", "COD Collected"; Reopen one; cancel the express order (confirm dialog) → customer menu `maxQty` back up. |
| V4 | Controls | Express off → customer checkout shows "Express delivery is currently unavailable."; Pause all (confirm) → customer menu banner; resume → banner gone. |
| V5 | Auth | `/admin` → login page; wrong password → "Wrong username or password."; log in; Log out → login page; `/admin` redirects again. |

## 6. Performance

### 6.1 Budgets (Batch 1 §10.5)

| Metric | Budget | How it's measured |
|---|---|---|
| JS for route `/`, gzipped | ≤ 130 KB | `scripts/check-bundle.ts` (below), in CI, built with `NODE_ENV` unset (Batch 1 §10.5) |
| Lighthouse Performance (mobile) | ≥ 90 | DevTools Lighthouse on `pnpm start:local` |
| Lighthouse Accessibility | ≥ 95 | same run |
| LCP on a real mid-range Android over 4G | ≤ 2.5 s | Manual M2 |
| CLS | ≤ 0.05 | Lighthouse |
| New customer, cold start to placed order | ≤ 60 s | Manual M3 (stopwatch, someone who hasn't seen the app) |

`scripts/check-bundle.ts`: with `build.manifest: true` in Vite, read `dist/client/.vite/manifest.json`, take the entry chunk plus its static `imports` recursively (not `dynamicImports`, so the lazy admin chunk is excluded), gzip each with `node:zlib`, sum, print a table, exit 1 above budget. Also fail if any chunk reachable from the entry contains code from `features/admin`.

### 6.2 Fixes to apply if a budget is missed (in this order)

1. Make sure admin code is only in the lazy chunk (the check above).
2. Switch shared schemas to `zod/mini`, or keep zod out of the menu route by importing schemas only in checkout.
3. Lazy-load the checkout, order and track routes (keep the menu in the entry). **(as built)** Already applied in Batch 5, with prefetching (Batch 5 §14); `/` was 123.68 KB gzipped afterwards.
4. Check fonts: two woff2 files preloaded at most; subsets as in Batch 2 §8.3.
5. Re-export images smaller.

### 6.3 Compression

Check `content-encoding` on `/assets/*.js` and the API through the production-like setup. If neither the platform (Batch 8) nor Express compresses responses, adding the `compression` middleware needs owner approval (it isn't in Batch 1 §4). Record the decision in Batch 1 §4 and Batch 8.

## 7. Accessibility pass

- Lighthouse Accessibility ≥ 95 on `/`, `/checkout`, `/order/:id`, `/track`, `/admin/login`, `/admin`.
- Keyboard only (desktop): the whole customer flow and the vendor's Today actions are reachable in a sensible order with a visible focus ring.
- TalkBack on Android: menu item cards, stepper, cart bar, radio groups, field errors and the confirmation order ID read correctly.
- After Place order, the confirmation moves focus to (or announces) its "ORDER PLACED" heading, so TalkBack users hear that the order went through.
- 200% browser zoom at 360 px: no clipped text, no lost controls.
- On every route change, focus moves to the page's `h1` and `document.title` updates (e.g. "Checkout · Bunty Biryani Centre", "Today · BBC Admin").
- Errors use the danger colour, an icon and text; status chips always have text.
- `prefers-reduced-motion` disables every transition and the skeleton pulse.

## 8. Mobile polish list

| Area | Check |
|---|---|
| Viewport | `width=device-width, initial-scale=1, viewport-fit=cover`; `min-height: 100dvh`; safe-area padding on sticky bars |
| Colour scheme | `<meta name="color-scheme" content="light">` and `color-scheme: light`, so Android's forced dark mode doesn't mangle the brand colours |
| Inputs | 16 px font (no iOS zoom); correct `inputmode`, `autocomplete`, `enterkeyhint`; keyboard never covers the focused field (Batch 4 §5.8) |
| Taps | ≥ 48 px targets, 8 px apart; `touch-action: manipulation` on steppers and buttons (no double-tap zoom); no hover-only affordances |
| Scrolling | Back from checkout restores the menu's scroll position; no layout jump when the cart bar appears; `overscroll-behavior-y: contain` on dialogs |
| Loading | Skeletons the same height as content; no spinner-only screens; images have dimensions |
| Fonts | `font-display: swap`; `₹` renders in Inter (latin-ext subset) |
| Text | Long names and addresses wrap; prices never wrap; checked at 320, 360, 412 px and landscape |
| Errors | `ErrorBoundary` around the routes: "Something went wrong." [Reload]; a 404 page with a link to the menu |
| Offline | `offline` / `online` events + failed fetches show a banner "You're offline. Orders can't be placed until you reconnect." |
| Install | `manifest.webmanifest`: `name` "Bunty Biryani Centre", `short_name` "BBC", `start_url` "/", `display` "standalone", `background_color` cream, `theme_color` sun-yellow, icons 192 and 512 (plus maskable) cut from the logo. No service worker in Phase 1 (no offline caching to go stale). |
| Sharing | Open Graph title, description and a 1200×630 image from the logo, so the link looks right when shared in WhatsApp groups |

## 9. Copy review with the owner

- `scripts/print-copy.ts` prints every string in `copy.ts` as a Markdown table (key, screen, text) to `docs/copy-review.md` (generated, not committed if the owner prefers).
- The owner reviews it, especially the brief's fixed phrases (§4, §9, §10, §11), the COD wording and the vendor screens. Changes go into `copy.ts` only.
- Brand name everywhere: "Bunty Biryani Centre".

## 10. Pre-deploy security review

- [ ] The only committed env files are `.env.example`, `.env.test` and `.env.e2e`, holding placeholders or local throwaway values; `.env` is ignored and no production value appears anywhere in the history.
- [ ] `git grep -n "queryRawUnsafe\|executeRawUnsafe"` finds nothing (also a CI step).
- [ ] The stock-writes guard (Batch 5 §3) is extended to status fields (Batch 6 §4) and passes.
- [ ] Access tests (Batch 6 #4–5) pass for every admin route.
- [ ] No CSP violations during e2e.
- [ ] The e2e server log contains no test phone number (`grep` in CI).
- [ ] `pnpm audit --prod` has no high or critical findings, or each is documented.
- [ ] Cookie flags in production config: `HttpOnly`, `Secure`, `SameSite=Lax` (B2 #12.3-4).
- [ ] Rate limits active with production values.

## 11. CI (GitHub Actions)

`.github/workflows/ci.yml` on every push and pull request:

1. Checkout; set up pnpm and Node 24; `pnpm install --frozen-lockfile` (its `postinstall` runs `prisma generate`). The job sets `DATABASE_URL` to the service container's `bbc_test` database so `prisma.config.ts` can load (Batch 1 §7.2).
2. Service container `postgres:16` with `bbc_test` and `bbc_e2e` databases.
3. `pnpm lint`, `pnpm typecheck`.
4. `git grep` checks from §10.
5. `pnpm test` (unit + integration).
6. `pnpm build` and `pnpm check:bundle`.
7. `pnpm exec playwright install --with-deps chromium`, then `pnpm test:e2e`; upload the Playwright report as an artifact on failure.

Branch protection on `main` requiring CI is recommended to the owner (it's a repository setting).

## 12. Owner acceptance session (local, two phones on the same Wi-Fi)

Walk through the brief §30 definition of done:

1. **Customer phone:** open the site → pick food → batch order → details → place → order ID. Repeat with express.
2. **Vendor phone:** open admin → see the new orders → COD, items, location, batch/express → answer "How many orders, and how many of each item, for MSH at 8 PM?" and "Which orders need to go out separately right now?" without scrolling or tapping more than once.
3. Morning stock setup, a cancellation, pausing express, pausing all.

Record findings in a table below this section (finding, batch, fix, done). Fix and repeat until the owner signs off.

## 13. Manual checks

| Id | Check |
|---|---|
| M1 | Real Android phone (Chrome, mid-range, about 4 GB RAM): every customer and vendor screen; no horizontal scroll; keyboard behaviour; TalkBack spot check |
| M2 | Same phone, mobile data or DevTools "Fast 4G" + 4× CPU slowdown: LCP on `/` ≤ 2.5 s |
| M3 | Someone who hasn't used the app places an order from a WhatsApp link in ≤ 60 s |
| M4 | iPhone Safari if one is available: the customer flow works (secondary target) |
| M5 | "Add to Home screen" opens standalone with the right icon and colours |
| M6 | Carried over from Batch 4 (moved here 2026-10-06): run K14 (Enter / the keyboard's action key moves Name → Mobile number → Room / address, closes the keyboard on Room, submits nothing) and the "Phone" row (repeat K2, K3, K7; the keyboard never covers the field being typed; TalkBack reads a disabled card's reason) from Batch 4 §13.5. Also confirm the sticky Place order bar hides while the in-form button is fully on screen (Batch 4 §5.8) |
| M7 | Carried over from Batch 3 (moved here 2026-10-06): the "Phone" row of Batch 3 §11.3. Repeat M1, M2 and M6 of that runbook by touch, then with TalkBack on build a cart of 2 Chicken Biryani + 1 Veg Biryani; TalkBack reads "Add Chicken Biryani", "Add one more Chicken Biryani", the quantity, and the cart bar as "Checkout, 3 items, ₹410" |
| M8 | Carried over from Batch 5 (moved here 2026-10-07): the "Phone (owner)" items 1–4 of Batch 5 §12.5 on a real Android phone (`pnpm dev:server` + `pnpm exec vite --host`): a batch and an express order, each confirmation checked and reloaded; lookup with the wrong phone, then the right one; Offline → Place order → error, online → Try again → exactly one order (`SELECT count(*) FROM orders`); two phones racing for the last item (one gets it, the other sees the sold-out message and an updated cart) |

## 14. Definition of done

- [ ] Every row in §3 is covered and passing.
- [ ] E2E C1–C15 and V1–V5 pass on both viewport projects.
- [ ] Budgets in §6.1 met (record the measured numbers here).
- [ ] Accessibility pass (§7) and polish list (§8) done.
- [ ] Copy signed off by the owner.
- [ ] Security review (§10) complete.
- [ ] CI green on `main`.
- [ ] Owner acceptance session (§12) signed off.
- [ ] `CLAUDE.md` batch table updated.

## 15. Files

`playwright.config.ts`, `.env.e2e`, `tests/e2e/{global-setup,helpers/db,helpers/assertions}.ts`, `tests/e2e/customer/*.spec.ts`, `tests/e2e/vendor/*.spec.ts`, `scripts/check-bundle.ts`, `scripts/print-copy.ts`, `src/client/public/manifest.webmanifest`, icons, Open Graph image, `src/client/components/{ErrorBoundary,OfflineBanner}.tsx`, `.github/workflows/ci.yml`, plus fixes in earlier batches' files.

New scripts: `test:e2e` (`playwright test`), `check:bundle` (`node --import tsx scripts/check-bundle.ts`), `copy:print`.

## 16. Commands

```bash
pnpm test
pnpm build && pnpm check:bundle
pnpm exec playwright install chromium     # once
pnpm test:e2e
pnpm test:e2e --ui                        # debug
pnpm start:local                          # then run Lighthouse (mobile) in Chrome DevTools
pnpm copy:print
```
