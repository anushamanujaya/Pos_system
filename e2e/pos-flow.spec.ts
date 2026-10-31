import { expect, test, type Page } from '@playwright/test';

const SKU = `E2E-${Date.now().toString().slice(-6)}`;
const NAME = `E2E Rice ${SKU}`;
const BARCODE = `47${Date.now().toString().slice(-10)}`;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.serial('supermarket critical path', () => {
  let adminPage: Page;
  let cashierPage: Page;
  let productUrl = '';
  let receiptNo = '';

  test.beforeAll(async ({ browser }) => {
    adminPage = await (await browser.newContext()).newPage();
    cashierPage = await (await browser.newContext()).newPage();
  });

  test('1. admin logs in', async () => {
    await login(adminPage, 'admin@e2e.local', 'Admin#12345');
    await expect(adminPage.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });

  test('2. admin creates a product', async () => {
    await adminPage.goto('/products/new');
    await adminPage.getByLabel('Product name').fill(NAME);
    await adminPage.getByLabel('SKU').fill(SKU);
    await adminPage.getByLabel('Barcode').fill(BARCODE);
    await adminPage.getByLabel('Category').selectOption({ label: 'E2E Category' });
    await adminPage.getByLabel('Unit of measure').selectOption({ label: 'Piece (pc)' });
    await adminPage.getByLabel('Purchase cost (Rs.)').fill('150.00');
    await adminPage.getByLabel('Selling price (Rs.)').fill('250.00');
    await adminPage.getByLabel('Reorder threshold').fill('2');
    await adminPage.getByRole('button', { name: 'Create product' }).click();
    await expect(adminPage.getByRole('heading', { name: NAME, level: 1 })).toBeVisible();
    productUrl = adminPage.url();
  });

  test('3. admin orders and receives inventory', async () => {
    await adminPage.goto('/purchases/new');
    await adminPage.getByLabel('Supplier').selectOption({ label: 'E2E Supplier' });
    await adminPage.getByPlaceholder('Search products to add (name, SKU, barcode)').fill(SKU);
    await adminPage.getByRole('button', { name: new RegExp(NAME) }).click();
    await adminPage.getByLabel(`Quantity for ${NAME}`).fill('10');
    await adminPage.getByRole('button', { name: 'Submit order' }).click();
    await adminPage.getByRole('button', { name: 'Receive goods' }).first().click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(adminPage.getByText('Received', { exact: true })).toBeVisible();
    await adminPage.goto(productUrl);
    await expect(adminPage.getByText('On hand').locator('xpath=..')).toContainText('10');
  });

  test('4-8. cashier opens shift, searches/scans, sells for cash and previews the receipt', async () => {
    await login(cashierPage, 'cashier@e2e.local', 'Cashier#12345');
    const scan = cashierPage.getByLabel('Scan barcode or search products');
    await expect(scan).toBeVisible();
    await cashierPage.getByRole('button', { name: 'Open shift' }).first().click();
    await cashierPage.getByRole('dialog').getByRole('button', { name: 'Open shift' }).click();
    await expect(cashierPage.getByText('No open cash shift')).toHaveCount(0);

    // search by SKU and tap the tile
    await scan.fill(SKU);
    await cashierPage.getByRole('button', { name: new RegExp(`Add ${NAME}`) }).click();
    await expect(cashierPage.getByLabel(`Quantity for ${NAME}`)).toHaveValue('1');
    // keyboard-wedge scan of the same barcode increments the quantity
    await scan.fill(BARCODE);
    await scan.press('Enter');
    await expect(cashierPage.getByLabel(`Quantity for ${NAME}`)).toHaveValue('2');
    await expect(cashierPage.getByTestId('grand-total')).toHaveText('Rs. 500.00');

    await cashierPage.keyboard.press('F4'); // shortcut opens payment
    const dlg = cashierPage.getByRole('dialog');
    await expect(dlg.getByText('Amount due')).toBeVisible();
    await dlg.getByLabel('Amount received').fill('1000.00');
    await expect(dlg.getByText('Rs. 500.00').last()).toBeVisible(); // change
    await dlg.getByRole('button', { name: 'Complete sale' }).click();
    await expect(cashierPage.getByRole('heading', { name: 'Sale complete' })).toBeVisible();
    const receipt = cashierPage.getByTestId('receipt');
    await expect(receipt).toContainText(NAME);
    await expect(receipt).toContainText('TOTAL');
    receiptNo = (await cashierPage.getByRole('dialog').locator('p.font-semibold').first().innerText()).trim();
    expect(receiptNo).toMatch(/^INV-/);
    await expect(cashierPage.getByRole('button', { name: 'Print' })).toBeVisible();
    await cashierPage.getByRole('button', { name: 'New sale' }).click();
  });

  test('9-10. inventory decreased and sale history updated', async () => {
    await adminPage.goto(productUrl);
    await expect(adminPage.getByText('On hand').locator('xpath=..')).toContainText('8');
    await adminPage.goto('/sales');
    await expect(adminPage.getByRole('row', { name: new RegExp(receiptNo) })).toContainText('Rs. 500.00');
  });

  test('11. cashier processes a partial return', async () => {
    await cashierPage.goto(`/returns/new?receipt=${encodeURIComponent(receiptNo)}`);
    await cashierPage.getByLabel(`Return quantity for ${NAME}`).fill('1');
    await cashierPage.getByLabel('Reason').fill('Customer changed mind');
    await cashierPage.getByRole('button', { name: 'Confirm refund' }).click();
    await expect(cashierPage.getByText('RETURN / REFUND')).toBeVisible();
    await expect(cashierPage.getByText('Rs. 250.00').first()).toBeVisible();
  });

  test('12. stock and reports reflect the return', async () => {
    await adminPage.goto(productUrl);
    await expect(adminPage.getByText('On hand').locator('xpath=..')).toContainText('9');
    await adminPage.goto('/reports');
    const refunds = adminPage.getByText('Refunds', { exact: true }).first().locator('xpath=../..');
    await expect(refunds).toContainText('Rs. 250.00');
  });

  test('13. cashier closes the shift with an exact count', async () => {
    await cashierPage.goto('/cash-registers');
    await cashierPage.getByRole('tab', { name: 'My active shift' }).click();
    await cashierPage.getByRole('button', { name: 'Close shift' }).first().click();
    await cashierPage.getByLabel('Counted cash (Rs.)').fill('250.00'); // 0 float + 500 sale - 250 refund
    await expect(cashierPage.getByText('Drawer balances exactly.')).toBeVisible();
    await cashierPage.getByRole('dialog').getByRole('button', { name: 'Close shift' }).click();
    await expect(cashierPage.locator('span', { hasText: /^Closed$/ })).toBeVisible();
    await expect(cashierPage.getByText('Rs. 0.00').first()).toBeVisible(); // variance
  });
});
