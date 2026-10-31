import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, RequireAuth } from '@/components/layout/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { DiscountDialog } from '@/features/pos/dialogs';
import { PaymentDialog } from '@/features/pos/PaymentDialog';
import { cartPayload, usePos } from '@/features/pos/store';
import { ApiError } from '@/lib/api';
import { toCents, money, dateStr } from '@/lib/format';
import { useAuth } from '@/stores/auth';

const post = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>();
  return { ...real, send: (...a: unknown[]) => post(...a), get: vi.fn(async () => ({ data: [] })) };
});

const wrap = (ui: React.ReactNode, path = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
  </QueryClientProvider>
);
const user = (permissions: string[], extra = {}) => ({
  id: '1',
  name: 'Test',
  email: 't@t.lk',
  role: 'CASHIER' as const,
  mustChangePassword: false,
  permissions,
  ...extra,
});

beforeEach(() => {
  post.mockReset();
  useAuth.setState({ accessToken: null, user: null, ready: true });
  usePos.getState().clear();
});

describe('login form', () => {
  it('validates fields before calling the API', async () => {
    render(wrap(<LoginPage />));
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('stores the session on success', async () => {
    post.mockResolvedValue({ data: { accessToken: 'tok', user: user(['sales.create']) } });
    render(
      wrap(
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/pos" element={<p>POS home</p>} />
        </Routes>,
      ),
    );
    await userEvent.type(screen.getByLabelText('Email'), 'cashier@demo.local');
    await userEvent.type(screen.getByLabelText('Password'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(useAuth.getState().accessToken).toBe('tok'));
    expect(await screen.findByText('POS home')).toBeInTheDocument();
  });

  it('shows a safe server error message', async () => {
    post.mockRejectedValue(new ApiError('Invalid email or password', 401, 'UNAUTHORIZED'));
    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.lk');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('route authorization', () => {
  const tree = (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/unauthorized" element={<p>not authorised</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/open" element={<p>open area</p>} />
      </Route>
      <Route element={<RequireAuth permission="reports.read" />}>
        <Route path="/reports" element={<p>reports area</p>} />
      </Route>
    </Routes>
  );
  it('redirects anonymous users to login', () => {
    render(wrap(tree, '/open'));
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
  it('blocks users lacking the permission', () => {
    useAuth.setState({ user: user(['sales.create']), accessToken: 't' });
    render(wrap(tree, '/reports'));
    expect(screen.getByText('not authorised')).toBeInTheDocument();
  });
  it('lets permitted users in', () => {
    useAuth.setState({ user: user(['reports.read']), accessToken: 't' });
    render(wrap(tree, '/reports'));
    expect(screen.getByText('reports area')).toBeInTheDocument();
  });
});

describe('cart state', () => {
  const p = {
    _id: 'p1',
    name: 'Rice',
    sku: 'R1',
    priceCents: 10000,
    onHandMilli: 5000,
    unitSymbol: 'pc',
    unitDecimals: 0,
  };
  it('adds products, increments repeated scans and updates quantity', () => {
    const s = usePos.getState();
    s.add(p);
    s.add(p);
    expect(usePos.getState().lines).toHaveLength(1);
    expect(usePos.getState().lines[0].quantity).toBe(2);
    usePos.getState().setQty('p1', 5);
    expect(usePos.getState().lines[0].quantity).toBe(5);
    usePos.getState().remove('p1');
    expect(usePos.getState().lines).toHaveLength(0);
  });
  it('never sends prices or totals to the server', () => {
    usePos.getState().add(p);
    usePos.getState().setDiscount('p1', { type: 'PERCENT', percent: 5 });
    const payload = cartPayload(usePos.getState().lines);
    expect(JSON.stringify(payload)).not.toMatch(/price|total/i);
    expect(payload.items[0]).toEqual({
      product: 'p1',
      quantity: 1,
      discount: { type: 'PERCENT', percent: 5, note: undefined },
    });
  });
  it('rotates the idempotency key whenever the cart changes', () => {
    const k1 = usePos.getState().idempotencyKey;
    usePos.getState().add(p);
    expect(usePos.getState().idempotencyKey).not.toBe(k1);
  });
});

describe('discount dialog', () => {
  it('rejects out-of-range percentages and applies valid ones', async () => {
    const onApply = vi.fn();
    render(<DiscountDialog open onOpenChange={() => {}} title="Discount" onApply={onApply} />);
    const input = screen.getByLabelText('Percent');
    await userEvent.type(input, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/between 0 and 100/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, '7.5');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith({ type: 'PERCENT', percent: 7.5, note: undefined });
  });
});

describe('payment dialog', () => {
  const setup = () => {
    usePos.getState().add({
      _id: 'p1',
      name: 'Rice',
      sku: 'R1',
      priceCents: 123450,
      onHandMilli: 9000,
      unitSymbol: 'pc',
      unitDecimals: 0,
    });
    return render(
      wrap(<PaymentDialog open onOpenChange={() => {}} totalCents={123450} expectedTotalCents={123450} />),
    );
  };
  it('shows change for cash overpayment and enables completion only when covered', async () => {
    setup();
    const amount = screen.getByLabelText('Amount received');
    const complete = screen.getByRole('button', { name: /complete sale/i });
    expect(complete).toBeEnabled();
    fireEvent.change(amount, { target: { value: '1000.00' } });
    expect(complete).toBeDisabled();
    expect(screen.getByText(/still due/i)).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: '1500.00' } });
    expect(complete).toBeEnabled();
    expect(screen.getByText(money(26550))).toBeInTheDocument();
  });

  it('submits with an idempotency key, then shows the success state with the receipt', async () => {
    post.mockResolvedValue({
      data: {
        receiptNo: 'INV-1',
        replayed: false,
        store: {
          name: 'Demo Mart',
          address: '',
          phone: '',
          email: '',
          logoUrl: '',
          taxId: '',
          timezone: 'Asia/Colombo',
        },
        receipt: { footer: 'Thanks', paperSize: '80mm' },
        sale: {
          _id: 's1',
          receiptNo: 'INV-1',
          cashierName: 'Test',
          items: [
            {
              _id: 'i',
              name: 'Rice',
              qtyMilli: 1000,
              unitPriceCents: 123450,
              grossCents: 123450,
              lineDiscountCents: 0,
              orderDiscountShareCents: 0,
              totalCents: 123450,
              unitSymbol: 'pc',
            },
          ],
          payments: [{ method: 'CASH', amountCents: 123450, tenderedCents: 150000 }],
          taxBreakdown: [],
          subtotalCents: 123450,
          discountCents: 0,
          taxCents: 0,
          totalCents: 123450,
          changeCents: 26550,
          refundedCents: 0,
          createdAt: new Date().toISOString(),
        },
      },
    });
    setup();
    const key = usePos.getState().idempotencyKey;
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '1500.00' } });
    await userEvent.click(screen.getByRole('button', { name: /complete sale/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [method, url, body, headers] = post.mock.calls[0];
    expect(method).toBe('post');
    expect(url).toBe('/sales');
    expect(headers['Idempotency-Key']).toBe(key);
    expect(body.payments).toEqual([{ method: 'CASH', amountCents: 150000, reference: undefined }]);
    expect(await screen.findByRole('heading', { name: 'Sale complete' })).toBeInTheDocument();
    expect(screen.getByTestId('receipt')).toHaveTextContent('Demo Mart');
    expect(usePos.getState().lines).toHaveLength(0); // cart cleared only after the server confirmed
  });

  it('keeps the cart and shows the error when checkout fails (e.g. insufficient stock)', async () => {
    post.mockRejectedValue(new ApiError('Insufficient stock for Rice', 409, 'INSUFFICIENT_STOCK'));
    setup();
    await userEvent.click(screen.getByRole('button', { name: /complete sale/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient stock for Rice');
    expect(usePos.getState().lines).toHaveLength(1);
  });
});

describe('error boundary and formatting', () => {
  it('catches render errors', () => {
    const Boom = () => {
      throw new Error('kaboom');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('kaboom');
  });
  it('formats LKR and dates the Sri Lankan way', () => {
    expect(money(125000)).toBe('Rs. 1,250.00');
    expect(toCents('1250.5')).toBe(125050);
    expect(Number.isNaN(toCents('1.234'))).toBe(true);
    expect(dateStr('2026-01-01T20:00:00Z')).toBe('02/01/2026'); // 01:30 next day in Colombo
  });
});
