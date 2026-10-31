import type { Page } from '@playwright/test';
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME } from '../global-setup.js';

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel(/^Username/i).fill(E2E_ADMIN_USERNAME);
  await page.getByLabel(/^Password/i).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: /^Log in/i }).click();
  await page.waitForURL('/admin');
}
