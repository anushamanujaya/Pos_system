import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Check, Crown, ScanLine, ShoppingBasket, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { homeFor } from '@/components/layout/guards';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { send } from '@/lib/api';
import { useAuth, type SessionUser } from '@/stores/auth';
import type { Role } from '@/stores/auth';
import { usePos } from '@/features/pos/store';

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof schema>;

const DEMO_ROLES: {
  role: Role;
  title: string;
  description: string;
  features: string[];
  icon: typeof Crown;
}[] = [
  {
    role: 'OWNER',
    title: 'Owner Demo',
    description: 'Full administration dashboard',
    features: ['Products and inventory', 'Employee management', 'Reports and settings', 'All Owner permissions'],
    icon: Crown,
  },
  {
    role: 'MANAGER',
    title: 'Manager Demo',
    description: 'Day-to-day store management',
    features: ['Management dashboard', 'Inventory management', 'Purchasing', 'Manager reports and permissions'],
    icon: BriefcaseBusiness,
  },
  {
    role: 'CASHIER',
    title: 'Cashier Demo',
    description: 'Fast, practical sales workflow',
    features: ['POS terminal', 'Sales operations', 'Customer management', 'Cash register access'],
    icon: ScanLine,
  },
];

export function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const [error, setError] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [demoLoading, setDemoLoading] = useState<Role | null>(null);
  const setSession = useAuth((s) => s.setSession);
  const { user, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const queryClient = useQueryClient();

  if (user) return <Navigate to={homeFor(can)} replace />;

  const finishLogin = (accessToken: string, sessionUser: SessionUser) => {
    queryClient.clear();
    usePos.getState().clear();
    setSession(accessToken, sessionUser);
    const from = (loc.state as { from?: string } | null)?.from;
    nav(from && from !== '/login' ? from : homeFor((p) => sessionUser.permissions.includes(p)), {
      replace: true,
    });
  };

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      const r = await send<{ accessToken: string; user: SessionUser }>('post', '/auth/login', v);
      finishLogin(r.data.accessToken, r.data.user);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const enterDemo = async (role: Role) => {
    setError(null);
    setDemoLoading(role);
    try {
      const r = await send<{ accessToken: string; user: SessionUser }>(
        'post',
        '/auth/demo',
        { role },
        { 'X-Requested-With': 'pos-web' },
      );
      finishLogin(r.data.accessToken, r.data.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDemoLoading(null);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-surface/80 via-background to-primary-soft/40 p-4 py-8">
      <div className={showDemo ? 'w-full max-w-5xl space-y-6' : 'w-full max-w-sm space-y-6'}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShoppingBasket className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Supermarket POS</h1>
            <p className="text-sm text-muted-foreground">
              {showDemo ? 'Choose a role and explore instantly' : 'Sign in to continue'}
            </p>
          </div>
        </div>
        {showDemo ? (
          <section className="space-y-5" aria-labelledby="demo-heading">
            <div className="rounded-lg border border-primary/20 bg-primary-soft/60 px-4 py-3 text-center">
              <h2 id="demo-heading" className="flex items-center justify-center gap-2 font-semibold text-primary">
                <Sparkles className="h-4 w-4" /> Explore Demo
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">No credentials required. Select the experience you want to preview.</p>
            </div>
            {error && (
              <div role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              {DEMO_ROLES.map(({ role, title, description, features, icon: Icon }) => (
                <article key={role} className="flex flex-col rounded-xl border bg-background p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop">
                  <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="font-semibold uppercase tracking-wide">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  <ul className="my-5 flex-1 space-y-2 text-sm">
                    {features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {feature}
                      </li>
                    ))}
                  </ul>
                  <Button className="w-full" loading={demoLoading === role} disabled={demoLoading !== null} onClick={() => void enterDemo(role)}>
                    Enter Demo
                  </Button>
                </article>
              ))}
            </div>
            <div className="text-center">
              <Button variant="link" onClick={() => { setShowDemo(false); setError(null); }}>
                Back to regular sign in
              </Button>
            </div>
          </section>
        ) : <form
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
          <div className="relative py-1 text-center text-xs text-muted-foreground before:absolute before:left-0 before:right-0 before:top-1/2 before:border-t">
            <span className="relative bg-background px-2">or</span>
          </div>
          <Button type="button" variant="outline" className="w-full border-primary/30 text-primary" onClick={() => { setShowDemo(true); setError(null); }}>
            <Sparkles className="h-4 w-4" /> Explore Demo
          </Button>
        </form>
        }
      </div>
    </div>
  );
}
