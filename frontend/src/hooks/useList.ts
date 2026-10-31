import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, type ApiMeta } from '@/lib/api';
import { useDebounced } from './useDebounced';

/** Server-side paginated / searchable / sortable list state + query in one place. */
export function useList<T>(
  key: string,
  url: string,
  initial: { limit?: number; sort?: string; filters?: Record<string, string | undefined> } = {},
  enabled = true,
) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string | undefined>(initial.sort);
  const [filters, setFilters] = useState<Record<string, string | undefined>>(initial.filters ?? {});
  const dq = useDebounced(q, 300);
  const params = {
    page,
    limit: initial.limit ?? 20,
    q: dq || undefined,
    sort,
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  };
  const query = useQuery({
    queryKey: [key, params],
    queryFn: () => get<T[]>(url, params),
    placeholderData: keepPreviousData,
    enabled,
  });
  return {
    rows: query.data?.data ?? [],
    meta: (query.data?.meta ?? {}) as ApiMeta,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    page,
    setPage: (p: number) => setPage(p),
    q,
    setQ: (v: string) => {
      setQ(v);
      setPage(1);
    },
    sort,
    setSort: (s: string | undefined) => {
      setSort(s);
      setPage(1);
    },
    filters,
    setFilter: (k: string, v: string | undefined) => {
      setFilters((f) => ({ ...f, [k]: v }));
      setPage(1);
    },
    params,
  };
}
