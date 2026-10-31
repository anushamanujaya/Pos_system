import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { ApiMeta } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingRows } from './states';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
  align?: 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  meta,
  onPage,
  sort,
  onSort,
  rowKey,
  onRowClick,
  emptyTitle,
  emptyDescription,
  emptyAction,
  fetching,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  meta?: ApiMeta;
  onPage?: (p: number) => void;
  sort?: string;
  onSort?: (s: string | undefined) => void;
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  fetching?: boolean;
}) {
  if (loading) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0)
    return (
      <EmptyState
        title={emptyTitle ?? 'No records found'}
        description={emptyDescription ?? 'Try changing your search or filters.'}
        action={emptyAction}
      />
    );

  const toggle = (k: string) => onSort?.(sort === k ? `-${k}` : sort === `-${k}` ? undefined : k);
  return (
    <div className={cn(fetching && 'opacity-70 transition-opacity')}>
      <Table>
        <THead>
          <TR>
            {columns.map((c) => {
              const active = c.sortKey && (sort === c.sortKey || sort === `-${c.sortKey}`);
              return (
                <TH
                  key={c.key}
                  className={cn(
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.className,
                  )}
                  aria-sort={active ? (sort!.startsWith('-') ? 'descending' : 'ascending') : undefined}
                >
                  {c.sortKey && onSort ? (
                    <button
                      className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                      onClick={() => toggle(c.sortKey!)}
                    >
                      {c.header}
                      {active ? (
                        sort!.startsWith('-') ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUp className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TH>
              );
            })}
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR
              key={rowKey(r)}
              className={cn(onRowClick && 'cursor-pointer hover:bg-surface/60')}
              onClick={() => onRowClick?.(r)}
              onKeyDown={(e) => {
                if (onRowClick && e.key === 'Enter') onRowClick(r);
              }}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <TD
                  key={c.key}
                  className={cn(
                    c.align === 'right' && 'text-right tabular',
                    c.align === 'center' && 'text-center',
                    c.className,
                  )}
                >
                  {c.cell(r)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      {meta?.pages !== undefined && onPage && <Pagination meta={meta} onPage={onPage} />}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta: ApiMeta; onPage: (p: number) => void }) {
  const { page = 1, pages = 1, total = 0, limit = 20 } = meta;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm"
    >
      <span className="text-muted-foreground tabular">
        {from}–{Math.min(page * limit, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular">
          Page {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
