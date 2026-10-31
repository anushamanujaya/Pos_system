import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        aria-label={placeholder}
        type="search"
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <Card>
      <CardBody className="space-y-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            'text-2xl font-semibold tabular',
            tone === 'danger' && 'text-danger',
            tone === 'warning' && 'text-warning',
            tone === 'success' && 'text-success',
          )}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardBody>
    </Card>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-center gap-2 border-b p-3">{children}</div>;
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 text-sm">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusBadgeTone(status: string): 'success' | 'warning' | 'danger' | 'primary' | 'neutral' {
  switch (status) {
    case 'COMPLETED':
    case 'RECEIVED':
    case 'CLOSED':
    case 'ACTIVE':
    case 'ok':
      return 'success';
    case 'PARTIALLY_RECEIVED':
    case 'DRAFT':
    case 'expiring':
    case 'warning':
      return 'warning';
    case 'CANCELLED':
    case 'VOIDED':
    case 'ARCHIVED':
    case 'expired':
    case 'critical':
      return 'danger';
    case 'ORDERED':
    case 'OPEN':
      return 'primary';
    default:
      return 'neutral';
  }
}
