export const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'DEMO'] as const;
export const EMPLOYEE_ROLES = ['OWNER', 'MANAGER', 'CASHIER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'catalog.manage',
  'inventory.read',
  'inventory.adjust',
  'inventory.receive',
  'purchases.read',
  'purchases.manage',
  'suppliers.read',
  'suppliers.manage',
  'customers.read',
  'customers.manage',
  'sales.create',
  'sales.read',
  'sales.read.all',
  'sales.refund',
  'sales.refund.approve',
  'discount.override',
  'promotions.manage',
  'reports.read',
  'employees.read',
  'employees.manage',
  'settings.manage',
  'cashregister.read',
  'cashregister.manage',
  'cashregister.operate',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const cashier: Permission[] = [
  'products.read',
  'inventory.read',
  'customers.read',
  'customers.manage',
  'sales.create',
  'sales.read',
  'sales.refund',
  'cashregister.operate',
  'cashregister.read',
];
const manager: Permission[] = [
  ...cashier,
  'products.create',
  'products.update',
  'products.delete',
  'catalog.manage',
  'inventory.adjust',
  'inventory.receive',
  'purchases.read',
  'purchases.manage',
  'suppliers.read',
  'suppliers.manage',
  'sales.read.all',
  'sales.refund.approve',
  'discount.override',
  'promotions.manage',
  'reports.read',
  'employees.read',
  'cashregister.manage',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>(PERMISSIONS),
  MANAGER: new Set<Permission>(manager),
  CASHIER: new Set<Permission>(cashier),
  DEMO: new Set<Permission>([
    'products.read', 'inventory.read', 'purchases.read', 'suppliers.read',
    'customers.read', 'sales.create', 'sales.read', 'sales.read.all',
    'reports.read', 'cashregister.read', 'cashregister.operate',
  ]),
};

export const can = (role: Role, perm: Permission) => ROLE_PERMISSIONS[role].has(perm);
export const permissionsFor = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];
