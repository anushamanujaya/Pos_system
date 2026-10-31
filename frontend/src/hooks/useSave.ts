import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errMsg, send } from '@/lib/api';

/** Mutation helper: sends the request, toasts the outcome, invalidates the given query keys. */
export function useSave<TBody = unknown, TRes = unknown>(opts: {
  method: 'post' | 'put' | 'patch' | 'delete';
  url: string | ((body: TBody) => string);
  invalidate: string[];
  success?: string;
  onDone?: (res: TRes) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) =>
      send<TRes>(
        opts.method,
        typeof opts.url === 'function' ? opts.url(body) : opts.url,
        opts.method === 'delete' ? undefined : body,
      ),
    onSuccess: (r) => {
      if (opts.success) toast.success(opts.success);
      opts.invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      opts.onDone?.(r.data);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}
