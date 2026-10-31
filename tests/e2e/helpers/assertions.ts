import { expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Asserts that the page has no horizontal overflow/scroll.
 */
export async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const isOverflowing = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return (
      doc.scrollWidth > doc.clientWidth ||
      (body ? body.scrollWidth > doc.clientWidth : false)
    );
  });
  expect(isOverflowing, 'Page must not have horizontal scroll').toBe(false);
}

/**
 * Attaches a listener that fails the test if any console error (including CSP) is logged.
 */
export function trackConsoleErrors(page: Page): { assertNoErrors: () => void } {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore browser network logs for expected HTTP status codes (e.g. 409 Conflict, 401 Unauthorized, 404 Not Found)
      if (text.includes('Failed to load resource: the server responded with a status of')) {
        return;
      }
      console.error('[BROWSER CONSOLE ERROR]', text);
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    console.error('[BROWSER PAGE ERROR]', err.message);
    errors.push(err.message);
  });

  return {
    assertNoErrors: () => {
      expect(errors, 'Browser console should not contain errors').toEqual([]);
    },
  };
}
