import { expect, test } from '@playwright/test';
import { assertNoHorizontalScroll, trackConsoleErrors } from '../helpers/assertions.js';
import { resetOrdersAndStock, setItemStock, setSlotCutoff } from '../helpers/db.js';

test.describe('Customer Orders (C1–C4)', () => {
  test.beforeEach(async () => {
    await resetOrdersAndStock();
  });

  test('C1: Batch order flow end-to-end', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/');
    await assertNoHorizontalScroll(page);

    // Add 2 x Chicken Biryani (item name 'Chicken Biryani', price 150)
    const chickenAdd = page.getByRole('button', { name: /Add Chicken Biryani/i });
    await chickenAdd.click();
    const chickenInc = page.getByRole('button', { name: /Add one more Chicken Biryani/i });
    await chickenInc.click();

    // Add 1 x Raita (price 20)
    const raitaAdd = page.getByRole('button', { name: /Add Raita/i });
    await raitaAdd.click();

    // Sticky cart bar: 3 items, ₹320
    const cartBar = page.getByRole('link', { name: /Checkout/i });
    await expect(cartBar).toBeVisible();
    await expect(cartBar).toContainText('3 items');
    await expect(cartBar).toContainText('320');

    // Proceed to Checkout
    await cartBar.click();
    await page.waitForURL('/checkout');
    await assertNoHorizontalScroll(page);

    // Method selection: Batch Delivery
    const batchRadio = page.getByRole('radio', { name: /Batch Delivery/i });
    await batchRadio.click();

    // Verify slots listed
    await expect(page.getByText(/MSH — 8:00 PM/i)).toBeVisible();
    await expect(page.getByText(/Kanhar — 8:45 PM/i)).toBeVisible();

    // Select MSH slot
    const mshSlot = page.getByRole('radio', { name: /MSH — 8:00 PM/i });
    await mshSlot.click();

    // Fill customer details
    await page.getByLabel(/^Name/i).fill('Rahul Sharma');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    // Verify summary: Free, ₹320, CASH ON DELIVERY
    await expect(page.getByText(/Free/i).first()).toBeVisible();
    await expect(page.getByText('₹320').first()).toBeVisible();
    await expect(page.getByText(/CASH ON DELIVERY/i)).toBeVisible();

    // Place order
    const placeOrderBtn = page.getByRole('button', { name: /^Place order/i });
    await placeOrderBtn.click();

    // Confirmation page
    await page.waitForURL(/\/order\/BB\d+/);
    await assertNoHorizontalScroll(page);

    await expect(page.getByRole('heading', { name: /ORDER PLACED/i })).toBeVisible();
    await expect(page.getByText('BB1001')).toBeVisible();
    await expect(page.getByText(/MSH/i).first()).toBeVisible();
    await expect(page.getByText(/8:00 PM/i).first()).toBeVisible();
    await expect(page.getByText('₹320').first()).toBeVisible();

    // Reload page -> still shows confirmation
    await page.reload();
    await expect(page.getByRole('heading', { name: /ORDER (PLACED|BB1001)/i })).toBeVisible();
    await expect(page.getByText('BB1001')).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C2: Express order flow end-to-end', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/');
    await assertNoHorizontalScroll(page);

    // Add 2 x Chicken Biryani
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('button', { name: /Add one more Chicken Biryani/i }).click();

    // Checkout
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');
    await assertNoHorizontalScroll(page);

    // Choose Express delivery
    const expressRadio = page.getByRole('radio', { name: /Express Delivery/i });
    await expressRadio.click();

    // Expect ETA notice
    await expect(page.getByText(/approximately 30–40 minutes/i).first()).toBeVisible();

    // Choose location: Kanhar
    const kanharRadio = page.getByRole('radio', { name: /^Kanhar/i });
    await kanharRadio.click();

    // Details
    await page.getByLabel(/^Name/i).fill('Amit Verma');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    // Summary has +₹30 fee (total ₹330)
    await expect(page.getByText('₹330').first()).toBeVisible();

    // Place order
    await page.getByRole('button', { name: /^Place order/i }).click();

    // Confirmation
    await page.waitForURL(/\/order\/BB\d+/);
    await assertNoHorizontalScroll(page);

    await expect(page.getByRole('heading', { name: /ORDER PLACED/i })).toBeVisible();
    await expect(page.getByText(/Approx\. 30–40 minutes/i)).toBeVisible();
    // Delivery window matches e.g. 7:40–7:50 PM
    await expect(page.getByText(/\d{1,2}:\d{2}–\d{1,2}:\d{2}\s+(AM|PM)/i)).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C3: Cutoff past triggers express fallback banner', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    // Set MSH cutoff to 19:00 (past server clock 19:10)
    await setSlotCutoff('MSH', '19:00');

    await page.goto('/');
    await page.getByRole('button', { name: /Add Chicken Biryani/i }).click();
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');

    await page.getByRole('radio', { name: /Batch Delivery/i }).click();

    // MSH slot shows closed message
    await expect(page.getByText(/Orders for this delivery slot are closed/i)).toBeVisible();
    await expect(
      page.getByText(/Batch orders for MSH are closed\. Express delivery is available/i),
    ).toBeVisible();

    // Click "Try Express Delivery"
    const tryExpressBtn = page.getByRole('button', { name: /Try Express Delivery/i });
    await expect(tryExpressBtn).toBeVisible();
    await tryExpressBtn.click();

    // Verifies Express is now selected and MSH location is selected
    const expressRadio = page.getByRole('radio', { name: /Express Delivery/i });
    await expect(expressRadio).toBeChecked();

    // Fill customer details and place express order
    await page.getByLabel(/^Name/i).fill('Pooja Nair');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    await page.getByRole('button', { name: /^Place order/i }).click();
    await page.waitForURL(/\/order\/BB\d+/);

    await expect(page.getByRole('heading', { name: /ORDER (PLACED|BB\d+)/i })).toBeVisible();
    await expect(page.getByText(/Express/i).first()).toBeVisible();

    consoleGuard.assertNoErrors();
  });

  test('C4: Sold out handling on menu and mid-checkout', async ({ page }) => {
    const consoleGuard = trackConsoleErrors(page);

    await page.goto('/');

    // Egg Biryani has stock 0 -> Sold out section with no Add button
    await expect(page.getByText(/Sold out/i).first()).toBeVisible();
    const eggCard = page.locator('article', { hasText: 'Egg Biryani' });
    await expect(eggCard).toBeVisible();
    await expect(eggCard.getByRole('button', { name: /Add/i })).toHaveCount(0);

    // Set Raita stock to 1
    await setItemStock('Raita', 1);
    await page.reload();

    // Add 1 Raita
    await page.getByRole('button', { name: /Add Raita/i }).click();

    // Go to checkout
    await page.getByRole('link', { name: /Checkout/i }).click();
    await page.waitForURL('/checkout');

    await page.getByRole('radio', { name: /Batch Delivery/i }).click();
    await page.getByRole('radio', { name: /MSH — 8:00 PM/i }).click();
    await page.getByLabel(/^Name/i).fill('Rohan');
    await page.getByLabel(/^Mobile number/i).fill('9876543210');

    // Sell out Raita while customer is on checkout page
    await setItemStock('Raita', 0);

    // Tap Place order
    await page.getByRole('button', { name: /^Place order/i }).click();

    // Should display notice that Raita sold out and was removed
    await expect(page.getByText(/Raita just sold out and was removed/i)).toBeVisible();

    consoleGuard.assertNoErrors();
  });
});
