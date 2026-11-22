import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test('login page has no automated WCAG 2 A/AA accessibility violations', async ({ page }) => {
  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response, 'login navigation should return an HTTP response').not.toBeNull();
  expect(response!.status()).toBeLessThan(500);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(
    results.violations.map(({ id, impact, description, nodes }) => ({
      id,
      impact,
      description,
      affectedElements: nodes.length,
    })),
    'Fix automated accessibility violations reported by axe-core',
  ).toEqual([]);
});
