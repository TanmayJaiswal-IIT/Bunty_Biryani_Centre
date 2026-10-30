import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { assertNoHorizontalScroll, trackConsoleErrors } from '../helpers/assertions.js';
import { loginAsAdmin } from '../helpers/auth.js';
import {
  getE2EPrisma,
  getFixtures,
  resetOrdersAndStock,
} from '../helpers/db.js';
import { E2E_ADMIN_USERNAME } from '../global-setup.js';

import type { CreateOrderResponse } from '../../../src/shared/api-types.js';

async function placeBatchOrder(
  request: APIRequestContext,
  locationId: number,
  slotId: number,
  items: Array<{ menuItemId: number; quantity: number }>,
  expectedTotal: number,
  customerName: string,
  customerPhone: string,
): Promise<CreateOrderResponse> {
  const res = await request.post('/api/orders', {
    data: {
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH',
      locationId,
      slotId,
      customerName,
      customerPhone,
      addressDetail: null,
      items,
      expectedTotal,
    },
  });
  expect(res.ok(), `Batch order placement failed: ${res.status()}`).toBe(true);
  return (await res.json()) as CreateOrderResponse;
}

async function placeExpressOrder(
  request: APIRequestContext,
  locationId: number,
  items: Array<{ menuItemId: number; quantity: number }>,
  expectedTotal: number,
  customerName: string,
  customerPhone: string,
  addressDetail = 'Room 204',
): Promise<CreateOrderResponse> {
  const res = await request.post('/api/orders', {
    data: {
      clientRequestId: randomUUID(),
      deliveryMode: 'EXPRESS',
      locationId,
      customerName,
      customerPhone,
      addressDetail,
      items,
      expectedTotal,
    },
  });
  expect(res.ok(), `Express order placement failed: ${res.status()}`).toBe(true);
  return (await res.json()) as CreateOrderResponse;
}

test.describe('Vendor Dashboard (V1–V5)', () => {
  test.beforeEach(async () => {
    await resetOrdersAndStock();
  });

  test('V1: Sees orders on Today dashboard', async ({ page, request }) => {
    const consoleGuard = trackConsoleErrors(page);
    const { msh, items } = await getFixtures();

    const chicken = items.find((i) => i.name === 'Chicken Biryani')!;
    const paneer = items.find((i) => i.name === 'Paneer Biryani')!;
    const raita = items.find((i) => i.name === 'Raita')!;
    const mshSlot = msh.slots.find((s) => s.deliveryTime === '20:00')!;

    // Helper places 2 MSH orders and 1 express order via the API
    await placeBatchOrder(
      request,
      msh.id,
      mshSlot.id,
      [{ menuItemId: chicken.id, quantity: 2 }],
      300,
      'Aman Gupta',
      '9876543210',
    );

    await placeBatchOrder(
      request,
      msh.id,
      mshSlot.id,
      [
        { menuItemId: paneer.id, quantity: 1 },
        { menuItemId: raita.id, quantity: 1 },
      ],
      150,
      'Priya Singh',
      '9876543211',
    );

    await placeExpressOrder(
      request,
      msh.id,
      [{ menuItemId: chicken.id, quantity: 1 }],
      180, // 150 + 30 express fee
      'Vikram Patel',
      '9876543212',
      'Room 204',
    );

    // Log in as vendor
    await loginAsAdmin(page);
    await assertNoHorizontalScroll(page);

    // Assert MSH card: shows "MSH — 8:00 PM", "2 orders", item breakdown, COD totals
    const mshSection = page.locator('section', { hasText: 'MSH — 8:00 PM' });
    await expect(mshSection).toBeVisible();
    await expect(mshSection.getByText(/2 orders · 4 items · ₹450 COD/i)).toBeVisible();
    await expect(
      mshSection.getByText(/Chicken Biryani ×2 · Paneer Biryani ×1 · Raita ×1/i),
    ).toBeVisible();

    // Assert Express section: active count, customer name, phone, timing
    const expressSection = page.locator('section', { hasText: /EXPRESS · 1 active/i });
    await expect(expressSection).toBeVisible();
    await expect(expressSection.getByText('Vikram Patel')).toBeVisible();
    await expect(expressSection.getByText('9876543212')).toBeVisible();
    await expect(expressSection.getByText(/Ordered .* · deliver approx\./i)).toBeVisible();

    // Assert Kanhar card: shows "No orders yet"
    const kanharSection = page.locator('section', { hasText: 'Kanhar — 8:45 PM' });
    await expect(kanharSection).toBeVisible();
    await expect(kanharSection.getByText('No orders yet')).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('V2: Stock and menu management reflect on customer menu', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await loginAsAdmin(page);
    await assertNoHorizontalScroll(page);

    // Navigate to Stock page
    await page.getByRole('link', { name: 'Stock' }).click();
    await page.waitForURL('/admin/stock');
    await assertNoHorizontalScroll(page);

    // Set Paneer Biryani stock to 5
    const paneerCard = page.locator('.rounded-card', { has: page.getByText('Paneer Biryani', { exact: true }) });
    const paneerInput = paneerCard.getByLabel('Total for today');
    await paneerInput.fill('5');
    await paneerInput.blur();

    // Click Save stock
    const saveStockBtn = page.getByRole('button', { name: /^Save stock/i });
    await saveStockBtn.click();
    await expect(page.getByText('Stock saved for today.')).toBeVisible();

    // Visit customer menu: Paneer Biryani can be added
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    const paneerAdd = page.getByRole('button', { name: /Add Paneer Biryani/i });
    await expect(paneerAdd).toBeVisible();
    await paneerAdd.click();
    await expect(page.getByRole('button', { name: /Add one more Paneer Biryani/i })).toBeVisible();

    // Navigate to Admin Menu
    await page.goto('/admin/menu');
    await assertNoHorizontalScroll(page);

    // Click Add item
    await page.getByRole('link', { name: 'Add item' }).click();
    await page.waitForURL('/admin/menu/new');
    await assertNoHorizontalScroll(page);

    // Fill form: Veg Biryani, ₹110
    await page.getByLabel(/^Name/i).fill('Veg Biryani');
    await page.getByLabel(/^Price/i).fill('110');
    await page.getByRole('button', { name: /^Add item/i }).click();

    // Confirm success message (hidden until stock is set)
    await expect(
      page.getByText(/Item added\. Set today's stock so customers can order it\./i),
    ).toBeVisible();

    // Check customer menu: Veg Biryani cannot be added yet (sold out)
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    await expect(page.getByRole('button', { name: /Add Veg Biryani/i })).toHaveCount(0);

    // Go to Stock page and set stock for Veg Biryani
    await page.goto('/admin/stock');
    await assertNoHorizontalScroll(page);

    const vegCard = page.locator('.rounded-card', { has: page.getByText('Veg Biryani', { exact: true }) });
    await expect(vegCard).toBeVisible();
    const vegInput = vegCard.getByLabel('Total for today');
    await vegInput.fill('10');
    await vegInput.blur();
    await page.getByRole('button', { name: /^Save stock/i }).click();
    await expect(page.getByText('Stock saved for today.')).toBeVisible();

    // Check customer menu: Veg Biryani is now visible and can be added
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    await expect(page.getByText('Veg Biryani')).toBeVisible();
    await expect(page.getByText('₹110').first()).toBeVisible();
    const vegAdd = page.getByRole('button', { name: /Add Veg Biryani/i });
    await expect(vegAdd).toBeVisible();
    await vegAdd.click();

    // Go back to Admin Menu and toggle "On menu" off
    await page.goto('/admin/menu');
    await assertNoHorizontalScroll(page);
    const vegMenuRow = page.locator('.rounded-card', { has: page.getByRole('link', { name: 'Veg Biryani' }) });
    const switchBtn = vegMenuRow.getByRole('switch', { name: 'On menu' });
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute('aria-checked', 'false');

    // Customer menu: Veg Biryani is now hidden from menu items
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    await expect(page.getByRole('heading', { name: 'Veg Biryani' })).toHaveCount(0);

    consoleGuard.assertNoErrors();
  });

  test('V3: Order actions (Mark all done, Reopen, Cancel express restores stock)', async ({
    page,
    request,
  }) => {
    const consoleGuard = trackConsoleErrors(page);
    const { msh, items } = await getFixtures();

    const chicken = items.find((i) => i.name === 'Chicken Biryani')!;
    const paneer = items.find((i) => i.name === 'Paneer Biryani')!;
    const mshSlot = msh.slots.find((s) => s.deliveryTime === '20:00')!;

    // Place 2 MSH orders and 1 express order
    await placeBatchOrder(
      request,
      msh.id,
      mshSlot.id,
      [{ menuItemId: chicken.id, quantity: 2 }],
      300,
      'Aman Gupta',
      '9876543210',
    );

    await placeBatchOrder(
      request,
      msh.id,
      mshSlot.id,
      [{ menuItemId: paneer.id, quantity: 1 }],
      130,
      'Priya Singh',
      '9876543211',
    );

    const expressOrder = await placeExpressOrder(
      request,
      msh.id,
      [{ menuItemId: chicken.id, quantity: 1 }],
      180,
      'Vikram Patel',
      '9876543212',
    );

    // Initial stockRemaining check for chicken biryani
    const prisma = getE2EPrisma();
    const chickenStockBefore = await prisma.menuItem.findUnique({
      where: { id: chicken.id },
    });
    // 30 - 3 (2 batch + 1 express) = 27
    expect(chickenStockBefore?.stockRemaining).toBe(27);

    // Log in as vendor
    await loginAsAdmin(page);
    await assertNoHorizontalScroll(page);

    // In MSH card, click "Mark all done"
    const mshSection = page.locator('section', { hasText: 'MSH — 8:00 PM' });
    await mshSection.getByRole('button', { name: 'Mark all done' }).click();

    // Confirm dialog opens with "Cash collected for all" checked
    const completeDialog = page.locator('dialog[open]');
    await expect(completeDialog.getByText('Complete all orders?')).toBeVisible();
    await completeDialog.getByRole('button', { name: 'Complete orders' }).click();
    await expect(completeDialog).toHaveCount(0);

    // Expand orders list
    await mshSection.getByText(/Show 2 orders/i).click();

    // Verify chips: both orders show "Completed" and "COD · Collected"
    await expect(mshSection.getByText('Completed', { exact: true })).toHaveCount(2);
    await expect(mshSection.getByText('COD · Collected')).toHaveCount(2);

    // Reopen one order
    const reopenBtn = mshSection.getByRole('button', { name: 'Reopen' }).first();
    await reopenBtn.click();
    // After reopening, Undo button is offered and completed orders drops to 1
    await expect(mshSection.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await expect(mshSection.getByText('Completed', { exact: true })).toHaveCount(1);

    // Cancel the express order
    const expressSection = page.locator('section', { hasText: /EXPRESS · 1 active/i });
    const orderOptionsBtn = expressSection.getByRole('button', { name: 'Order options' });
    await orderOptionsBtn.click();

    await page.getByRole('button', { name: 'Cancel order' }).click();

    // Cancel confirmation dialog
    const cancelDialog = page.locator('dialog[open]');
    await expect(cancelDialog.getByText(/Cancel order BB/i)).toBeVisible();
    await cancelDialog.getByRole('button', { name: 'Cancel order' }).click();
    await expect(cancelDialog).toHaveCount(0);

    // Express order is cancelled: Express section shows 0 active
    await expect(page.getByText('No active express orders.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /EXPRESS · 0 active/i })).toBeVisible();

    const dbExpress = await prisma.order.findUnique({
      where: { orderNumber: expressOrder.orderNumber },
    });
    expect(dbExpress?.status).toBe('CANCELLED');

    // Verify stock restoration in database: chickenBiryani stockRemaining returned 1 -> 28
    const chickenStockAfter = await prisma.menuItem.findUnique({
      where: { id: chicken.id },
    });
    expect(chickenStockAfter?.stockRemaining).toBe(28);

    consoleGuard.assertNoErrors();
  });

  test('V4: Controls (pause express, pause all orders)', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await loginAsAdmin(page);
    await assertNoHorizontalScroll(page);

    // Toggle Express delivery off
    const expressSwitch = page.getByRole('switch', { name: 'Express delivery' });
    await expressSwitch.click();
    await expect(expressSwitch).toHaveAttribute('aria-checked', 'false');

    // Customer checkout shows express delivery unavailable
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await assertNoHorizontalScroll(page);

    await expect(
      page.getByText('Express delivery is currently unavailable.'),
    ).toBeVisible();

    // Return to admin and pause all orders
    await page.goto('/admin');
    await assertNoHorizontalScroll(page);

    const ordersSwitch = page.getByRole('switch', { name: 'Orders' });
    await ordersSwitch.click();

    // Confirm dialog
    const pauseDialog = page.locator('dialog[open]');
    await expect(pauseDialog.getByText('Pause all orders?')).toBeVisible();
    await pauseDialog.getByRole('button', { name: 'Pause orders' }).click();
    await expect(pauseDialog).toHaveCount(0);
    await expect(ordersSwitch).toHaveAttribute('aria-checked', 'false');

    // Customer menu displays orders paused banner
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    await expect(
      page.getByText('Orders are temporarily paused. Please check again shortly.'),
    ).toBeVisible();

    // Resume orders from admin
    await page.goto('/admin');
    await assertNoHorizontalScroll(page);
    await page.getByRole('switch', { name: 'Orders' }).click();
    await expect(page.getByRole('switch', { name: 'Orders' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Customer menu banner is cleared
    await page.goto('/');
    await assertNoHorizontalScroll(page);
    await expect(
      page.getByText('Orders are temporarily paused. Please check again shortly.'),
    ).toHaveCount(0);

    consoleGuard.assertNoErrors();
  });

  test('V5: Admin authentication and route protection', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    // Clear cookies to ensure unauthenticated state
    await page.context().clearCookies();

    // Navigate to /admin -> should redirect to /admin/login?next=%2Fadmin
    await page.goto('/admin');
    await page.waitForURL(/\/admin\/login/);
    await assertNoHorizontalScroll(page);

    await expect(page.getByRole('heading', { name: /VENDOR LOGIN/i })).toBeVisible();

    // Attempt login with wrong password
    await page.getByLabel(/^Username/i).fill(E2E_ADMIN_USERNAME);
    await page.getByLabel(/^Password/i).fill('wrong-password');
    await page.getByRole('button', { name: /^Log in/i }).click();

    await expect(page.getByText('Wrong username or password.')).toBeVisible();

    // Log in with correct credentials
    await page.getByLabel(/^Password/i).fill('e2e-password-12345');
    await page.getByRole('button', { name: /^Log in/i }).click();

    await page.waitForURL('/admin');
    await assertNoHorizontalScroll(page);
    await expect(page.getByRole('heading', { name: /TODAY/i })).toBeVisible();

    // Log out via the header overflow menu
    await page.getByRole('button', { name: /More options/i }).click();
    await page.getByRole('button', { name: /Log out/i }).click();

    await page.waitForURL('/admin/login');
    await assertNoHorizontalScroll(page);

    // Re-navigating to /admin should redirect again
    await page.goto('/admin');
    await page.waitForURL(/\/admin\/login/);
    await expect(page.getByRole('heading', { name: /VENDOR LOGIN/i })).toBeVisible();

    consoleGuard.assertNoErrors();
  });
});
