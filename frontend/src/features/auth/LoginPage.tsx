import { zodResolver } from '@hookform/resolvers/zod';
import { ShoppingBasket } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { homeFor } from '@/components/layout/guards';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { send } from '@/lib/api';
import { useAuth, type SessionUser } from '@/stores/auth';

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuth((s) => s.setSession);
  const { user, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  if (user) return <Navigate to={homeFor(can)} replace />;

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      const r = await send<{ accessToken: string; user: SessionUser }>('post', '/auth/login', v);
      setSession(r.data.accessToken, r.data.user);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from && from !== '/login' ? from : homeFor((p) => r.data.user.permissions.includes(p)), {
        replace: true,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-surface/60 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingBasket className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Supermarket POS</h1>
            <p className="text-sm text-muted-foreground">Sign in to continue</p>
            {import.meta.env.VITE_DEMO_MODE === 'true' && (
              <p className="mt-2 rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-sm text-primary">
                Public Demo Mode — sign in with the shared demo account. All transactions use sample data.
              </p>
            )}
          </div>
        </div>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="space-y-4 rounded-lg border bg-background p-6 shadow-card"
          aria-label="Sign in"
        >
          {error && (
            <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="username" autoFocus {...register('email')} />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
