import { test, expect } from '@playwright/test';

test('public home page responds without a server error', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  expect(response, 'home navigation should return an HTTP response').not.toBeNull();
  expect(response!.status(), 'home page should not return a server error').toBeLessThan(500);
  await expect(page.locator('body')).not.toBeEmpty();
});

test('login page responds without a server error', async ({ page }) => {
  const response = await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  expect(response, 'login navigation should return an HTTP response').not.toBeNull();
  expect(response!.status(), 'login page should not return a server error').toBeLessThan(500);
  await expect(page.locator('body')).not.toBeEmpty();
});
