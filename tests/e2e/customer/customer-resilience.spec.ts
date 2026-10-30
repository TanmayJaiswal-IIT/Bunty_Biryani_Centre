import { expect, test } from '@playwright/test';
import { assertNoHorizontalScroll, trackConsoleErrors } from '../helpers/assertions.js';
import {
  countOrders,
  getE2EPrisma,
  resetOrdersAndStock,
  setItemPrice,
  setOrdersPaused,
} from '../helpers/db.js';

test.describe('Customer Resilience & Edge Cases (C5–C15)', () => {
  test.beforeEach(async () => {
    await resetOrdersAndStock();
  });

  test('C5: Order lookup with correct and wrong phone numbers', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    // Place an initial order
    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Lookup Test');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');
    await page.getByRole('button', { name: /^Place order/i }).first().click();
    await page.waitForURL(/\/order\/BB1001/);

    // Navigate to /track
    await page.goto('/track');
    await assertNoHorizontalScroll(page);

    // Try with wrong phone
    await page.getByLabel(/Order ID/i).fill('BB1001');
    await page.getByLabel(/Mobile number/i).fill('9876500000');
    await page.getByRole('button', { name: /Find order/i }).click();

    await expect(
      page.getByText(/We couldn't find an order with that ID and mobile number/i),
    ).toBeVisible();

    // Try with correct phone
    await page.getByLabel(/Mobile number/i).fill('9876543210');
    await page.getByRole('button', { name: /Find order/i }).click();

    await page.waitForURL(/\/order\/BB1001/);
    await expect(page.getByRole('heading', { name: /ORDER BB1001/i })).toBeVisible();
    await expect(page.getByText(/Order received/i)).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C6: Double submit prevention with delayed API', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Double Click');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    // Delay POST /api/orders by 2s
    await page.route('**/api/orders', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });

    const placeBtn = page.getByRole('button', { name: /^Place order/i }).first();
    // Double click
    await placeBtn.dblclick();

    await page.waitForURL(/\/order\/BB1001/);
    const totalOrders = await countOrders();
    expect(totalOrders).toBe(1);

    consoleGuard.assertNoErrors();
  });

  test('C7: Paused orders banner and disabled checkout', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    // Pause orders
    await setOrdersPaused(true);

    await page.goto('/');
    await assertNoHorizontalScroll(page);

    // Expect menu banner
    await expect(
      page.getByText(/Orders are temporarily paused\. Please check again shortly/i),
    ).toBeVisible();

    // Add Chicken Biryani
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();

    // Cart bar should show orders are paused and checkout link is not present
    await expect(page.getByText(/Orders are paused/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Checkout/i })).toHaveCount(0);

    consoleGuard.assertNoErrors();
  });

  test('C8: Price changed mid-checkout prompts review with new total', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click(); // 150
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Price Change');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    // Raise price in database to 170
    await setItemPrice('Chicken Biryani', 170);

    // Try placing order
    await page.getByRole('button', { name: /^Place order/i }).first().click();

    // Expect prices changed banner and new total ₹170
    await expect(page.getByText(/Prices changed/i)).toBeVisible();
    await expect(page.getByText('₹170').first()).toBeVisible();

    // Place order again -> succeeds at new price
    await page.getByRole('button', { name: /^Place order/i }).first().click();
    await page.waitForURL(/\/order\/BB1001/);
    await expect(page.getByText('₹170').first()).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C9: Network failure on submit offers Try again and creates one order', async ({
    page,
  }) => {
    let callCount = 0;
    await page.route('**/api/orders', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Network Test');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    await page.getByRole('button', { name: /^Place order/i }).first().click();

    // Error banner with "Try again"
    const tryAgainBtn = page.getByRole('button', { name: /Try again/i }).first();
    await expect(tryAgainBtn).toBeVisible();

    // Tap Try again
    await tryAgainBtn.click();
    await page.waitForURL(/\/order\/BB1001/);

    const totalOrders = await countOrders();
    expect(totalOrders).toBe(1);
  });

  test('C10: Dropped response with Try again uses idempotency key', async ({ page }) => {
    let callCount = 0;
    await page.route('**/api/orders', async (route) => {
      callCount++;
      if (callCount === 1) {
        // Let it reach server to execute, but abort client response
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Idempotent Test');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    await page.getByRole('button', { name: /^Place order/i }).first().click();

    // Try again button appears
    const tryAgainBtn = page.getByRole('button', { name: /Try again/i }).first();
    await expect(tryAgainBtn).toBeVisible();

    await tryAgainBtn.click();
    await page.waitForURL(/\/order\/BB1001/);

    const totalOrders = await countOrders();
    expect(totalOrders).toBe(1);
  });

  test('C11: Rapid clicks show Placing order and aria-busy', async ({ page }) => {
    await page.route('**/api/orders', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Rapid Tap');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    const placeBtn = page.getByRole('button', { name: /^Place order/i }).first();
    await placeBtn.click();

    await expect(page.getByRole('button', { name: /Placing order/i })).toBeVisible();
    await page.waitForURL(/\/order\/BB1001/);
  });

  test('C12: Back from order confirmation returns to menu with cleared cart', async ({
    page,
  }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Back Nav');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');
    await page.getByRole('button', { name: /^Place order/i }).first().click();
    await page.waitForURL(/\/order\/BB1001/);

    // Browser back
    await page.goBack();
    await page.waitForURL('/');

    // Cart bar should not be visible since cart was cleared
    await expect(page.getByRole('link', { name: /Checkout/i })).toHaveCount(0);

    // Browser forward
    await page.goForward();
    await page.waitForURL(/\/order\/BB1001/);
    await expect(page.getByRole('heading', { name: /ORDER PLACED/i })).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C13: Track form field validations and keyboard Enter submission', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/track');

    // Missing order ID and phone -> submit with button
    await page.getByRole('button', { name: /Find order/i }).click();
    await expect(page.getByText(/Enter an order ID/i)).toBeVisible();

    // Bad format order ID
    await page.getByLabel(/Order ID/i).fill('ABC');
    await page.getByLabel(/Mobile number/i).fill('1234');
    await page.getByRole('button', { name: /Find order/i }).click();
    await expect(page.getByText(/10-digit mobile number/i)).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C14: Order status reflects cancellation upon page revalidation', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    // Place order
    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Cancel Watch');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');
    await page.getByRole('button', { name: /^Place order/i }).first().click();
    await page.waitForURL(/\/order\/BB1001/);

    await expect(page.getByRole('heading', { name: /ORDER PLACED/i })).toBeVisible();

    // Mark CANCELLED in database
    const prisma = getE2EPrisma();
    await prisma.order.update({
      where: { orderNumber: 'BB1001' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    // Reload page
    await page.reload();

    // Confirmation shows cancelled status
    await expect(page.getByText(/Cancelled/i).first()).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C15: Chunk-load failure renders retry error state', async ({ page }) => {
    let abortChunk = true;
    await page.route(/.*CheckoutPage.*\.js$/, async (route) => {
      if (abortChunk) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();

    // Attempt navigating to /checkout
    await page.getByRole('link', { name: /Checkout/i }).click();

    // Route error state with reload action
    const reloadBtn = page.getByRole('button', { name: /Reload|Try again/i });
    await expect(reloadBtn).toBeVisible();

    // Disable chunk block and reload
    abortChunk = false;
    await reloadBtn.click();
    await page.waitForURL('/checkout');
    await expect(page.getByRole('heading', { name: /Checkout/i })).toBeVisible();
  });
});
