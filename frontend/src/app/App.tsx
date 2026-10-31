import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary, RequireAuth, homeFor } from '@/components/layout/guards';
import { Spinner } from '@/components/shared/states';
import { useAuth } from '@/stores/auth';
import { LoginPage } from '@/features/auth/LoginPage';
import { NotFoundPage, UnauthorizedPage } from '@/features/misc/ErrorPages';

const L = <T extends Record<string, unknown>>(f: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await f())[name] as React.ComponentType }));
const Dashboard = L(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage');
const Pos = L(() => import('@/features/pos/PosPage'), 'PosPage');
const Products = L(() => import('@/features/products/ProductsPage'), 'ProductsPage');
const ProductForm = L(() => import('@/features/products/ProductFormPage'), 'ProductFormPage');
const ProductDetail = L(() => import('@/features/products/ProductDetailPage'), 'ProductDetailPage');
const Catalog = L(() => import('@/features/categories/CatalogPage'), 'CatalogPage');
const Inventory = L(() => import('@/features/inventory/InventoryPage'), 'InventoryPage');
const Purchases = L(() => import('@/features/purchases/PurchasesPage'), 'PurchasesPage');
const NewPurchase = L(() => import('@/features/purchases/NewPurchasePage'), 'NewPurchasePage');
const PurchaseDetail = L(() => import('@/features/purchases/PurchaseDetailPage'), 'PurchaseDetailPage');
const Suppliers = L(() => import('@/features/suppliers/SuppliersPage'), 'SuppliersPage');
const SupplierDetail = L(() => import('@/features/suppliers/SuppliersPage'), 'SupplierDetailPage');
const Sales = L(() => import('@/features/sales/SalesPage'), 'SalesPage');
const SaleDetail = L(() => import('@/features/sales/SalesPage'), 'SaleDetailPage');
const Returns = L(() => import('@/features/returns/ReturnsPage'), 'ReturnsPage');
const NewReturn = L(() => import('@/features/returns/ReturnsPage'), 'NewReturnPage');
const ReturnDetail = L(() => import('@/features/returns/ReturnsPage'), 'ReturnDetailPage');
const Customers = L(() => import('@/features/customers/CustomersPage'), 'CustomersPage');
const CustomerDetail = L(() => import('@/features/customers/CustomersPage'), 'CustomerDetailPage');
const Employees = L(() => import('@/features/employees/EmployeesPage'), 'EmployeesPage');
const EmployeeDetail = L(() => import('@/features/employees/EmployeesPage'), 'EmployeeDetailPage');
const Roles = L(() => import('@/features/employees/EmployeesPage'), 'RolesPage');
const Cash = L(() => import('@/features/cash-registers/CashRegistersPage'), 'CashRegistersPage');
const ShiftDetail = L(() => import('@/features/cash-registers/CashRegistersPage'), 'ShiftDetailPage');
const Reports = L(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const Notifications = L(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage');
const Settings = L(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const Audit = L(() => import('@/features/settings/SettingsPage'), 'AuditLogPage');
const Profile = L(() => import('@/features/auth/ProfilePage'), 'ProfilePage');

const Home = () => {
  const can = useAuth((s) => s.can);
  return can('reports.read') ? <Dashboard /> : <Navigate to={homeFor(can)} replace />;
};

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="profile" element={<Profile />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="unauthorized" element={<UnauthorizedPage />} />
              <Route element={<RequireAuth permission="sales.create" />}>
                <Route path="pos" element={<Pos />} />
              </Route>
              <Route element={<RequireAuth permission="products.read" />}>
                <Route path="products" element={<Products />} />
                <Route path="products/:id" element={<ProductDetail />} />
                <Route path="catalog" element={<Catalog />} />
              </Route>
              <Route element={<RequireAuth permission="products.create" />}>
                <Route path="products/new" element={<ProductForm />} />
              </Route>
              <Route element={<RequireAuth permission="products.update" />}>
                <Route path="products/:id/edit" element={<ProductForm />} />
              </Route>
              <Route element={<RequireAuth permission="inventory.read" />}>
                <Route path="inventory" element={<Inventory />} />
              </Route>
              <Route element={<RequireAuth permission="purchases.read" />}>
                <Route path="purchases" element={<Purchases />} />
                <Route path="purchases/:id" element={<PurchaseDetail />} />
              </Route>
              <Route element={<RequireAuth permission="purchases.manage" />}>
                <Route path="purchases/new" element={<NewPurchase />} />
              </Route>
              <Route element={<RequireAuth permission="suppliers.read" />}>
                <Route path="suppliers" element={<Suppliers />} />
                <Route path="suppliers/:id" element={<SupplierDetail />} />
              </Route>
              <Route element={<RequireAuth permission="sales.read" />}>
                <Route path="sales" element={<Sales />} />
                <Route path="sales/:id" element={<SaleDetail />} />
                <Route path="returns" element={<Returns />} />
                <Route path="returns/:id" element={<ReturnDetail />} />
              </Route>
              <Route element={<RequireAuth permission="sales.refund" />}>
                <Route path="returns/new" element={<NewReturn />} />
              </Route>
              <Route element={<RequireAuth permission="customers.read" />}>
                <Route path="customers" element={<Customers />} />
                <Route path="customers/:id" element={<CustomerDetail />} />
              </Route>
              <Route element={<RequireAuth permission="employees.read" />}>
                <Route path="employees" element={<Employees />} />
                <Route path="employees/roles" element={<Roles />} />
                <Route path="employees/:id" element={<EmployeeDetail />} />
              </Route>
              <Route element={<RequireAuth permission="cashregister.read" />}>
                <Route path="cash-registers" element={<Cash />} />
                <Route path="cash-registers/shifts/:id" element={<ShiftDetail />} />
              </Route>
              <Route element={<RequireAuth permission="reports.read" />}>
                <Route path="reports" element={<Reports />} />
              </Route>
              <Route element={<RequireAuth permission="settings.manage" />}>
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route element={<RequireAuth permission="audit.read" />}>
                <Route path="audit" element={<Audit />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
