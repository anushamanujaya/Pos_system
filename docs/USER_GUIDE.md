# User guide

## First-time setup (owner)
1. Sign in with the owner account created by `npm run init:admin` (or a demo account in development).
2. **Settings → Store & receipts**: store name, address, phone, footer, paper size, invoice prefix.
3. **Settings → Tax**: add the tax rates that apply to you (none are built in) and say whether prices include tax. Assign a tax to each product on its edit page.
4. **Categories**: add categories/brands; check **Units** (decimals: 0 for pieces, up to 3 for kg/l).
5. **Employees**: add managers and cashiers (they must change the temporary password at first sign-in).
6. **Cash Registers**: add registers. Add products, then receive stock (below).

## Daily cashier workflow
1. Sign in → **POS Terminal** → **Open shift**: choose a register, count the drawer, enter the opening float.
2. Scan items (the search box keeps focus; scanners that "type + Enter" work) or search by name/SKU and tap a tile. Scanning the same item again adds 1.
3. Adjust quantity with +/− or by typing. Weighed items accept decimals (e.g. 1.250 kg).
4. Optional: line **Discount**, **Order discount**, **Walk-in customer** → attach a customer.
5. **Pay** (`F4`): cash and/or card. For card, complete the payment on the external card terminal first and enter the amount (and terminal reference). Change is shown; **Complete sale**.
6. The receipt preview appears: choose paper size and **Print**. Click **New sale**.
7. End of day: **Cash Registers → My active shift → Close shift**, enter the counted cash. The system shows overage/shortage against expected cash (float + cash sales − cash refunds ± cash in/out).

Shortcuts: `F2` focus scan box · `F4` payment · `F8` hold sale · `F9` resume sale · `Esc` close dialog · `Enter` add scanned item / confirm payment.
Held sales are stored on the server (survive page reloads).

If prices or stock changed while the cart was open, the sale is refused with a message and the cart is recalculated; nothing is charged or deducted.
A double click on **Complete sale** cannot create two sales.

## Returns
**Returns → Process return** (or **Sales → sale → Process return**): enter the receipt number, enter the quantity per line, choose *Restock* (goes back on the shelf) or *Damaged* (written off), choose the refund method (must match how it was paid), give a reason. Cash refunds are paid from your open shift's drawer. The refund can never exceed what was sold and paid. Refunds may require a manager if the setting is on.

## Stock and purchasing (managers)
* **Purchases → New purchase order** → Submit → when goods arrive **Receive goods** (partial deliveries are fine; enter batch/expiry for expiry-tracked items).
* **Inventory → Stock overview → Adjust** for damages, expiry write-offs and corrections (reason required). Every change appears in **Movement history**.
* Low-stock and expiry alerts appear in **Notifications** (bell icon).
* **Products → Import CSV**: download the template; use *Validate only* first. Invalid rows are listed with their line number.

## Reports
**Reports** has Sales, Products, Profit, Inventory, Purchases, Cashiers and Cash reconciliation tabs. Choose dates (store timezone), export CSV, or Print. Gross profit = net sales excluding tax − cost of goods sold (not net business profit).

## Receipts and printing
Receipts print via the browser print dialog (58 mm / 80 mm / A4 layouts). Tips: choose the thermal printer, set margins to "None/Minimum", turn off headers/footers, and set the paper size to match. Browser printing **cannot** auto-cut paper, kick a cash drawer or bypass the dialog; that needs a native ESC/POS bridge that is not part of this project.

## Roles
Cashier: POS, own sales, returns. Manager: + catalogue, inventory, purchasing, reports, discount override, cash in/out. Owner: + employees, settings, audit log. See **Employees → Roles & permissions**.
