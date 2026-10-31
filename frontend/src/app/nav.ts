import {
  Bell,
  Boxes,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  Landmark,
  PackageSearch,
  ReceiptText,
  RotateCcw,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  end?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'reports.read', end: true },
  { to: '/pos', label: 'POS Terminal', icon: ScanBarcode, permission: 'sales.create' },
  { to: '/products', label: 'Products', icon: PackageSearch, permission: 'products.read' },
  { to: '/catalog', label: 'Categories', icon: Tags, permission: 'products.read' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory.read' },
  { to: '/purchases', label: 'Purchases', icon: ClipboardList, permission: 'purchases.read' },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'suppliers.read' },
  { to: '/sales', label: 'Sales', icon: ReceiptText, permission: 'sales.read' },
  { to: '/returns', label: 'Returns', icon: RotateCcw, permission: 'sales.read' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'customers.read' },
  { to: '/employees', label: 'Employees', icon: UserCog, permission: 'employees.read' },
  { to: '/cash-registers', label: 'Cash Registers', icon: Landmark, permission: 'cashregister.read' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, permission: 'reports.read' },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
];

export const TITLES: [string, string][] = [
  ['/pos', 'POS Terminal'],
  ['/products', 'Products'],
  ['/catalog', 'Categories, Brands & Units'],
  ['/inventory', 'Inventory'],
  ['/purchases', 'Purchases'],
  ['/suppliers', 'Suppliers'],
  ['/sales', 'Sales'],
  ['/returns', 'Returns'],
  ['/customers', 'Customers'],
  ['/employees', 'Employees'],
  ['/cash-registers', 'Cash Registers'],
  ['/reports', 'Reports'],
  ['/notifications', 'Notifications'],
  ['/settings', 'Settings'],
  ['/audit', 'Audit Log'],
  ['/profile', 'My Profile'],
];

export const titleFor = (path: string) =>
  path === '/' ? 'Dashboard' : (TITLES.find(([p]) => path.startsWith(p))?.[1] ?? 'Supermarket POS');
export const ShoppingCartIcon = ShoppingCart;
