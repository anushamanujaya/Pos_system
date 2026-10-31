import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/shared/states';
import { useAuth } from '@/stores/auth';

/** Requires a signed-in user; optionally a specific permission (enforced for real on the server too). */
export function RequireAuth({ permission }: { permission?: string }) {
  const { user, ready } = useAuth();
  const can = useAuth((s) => s.can);
  const loc = useLocation();
  if (!ready)
    return (
      <div className="grid h-screen place-items-center">
        <Spinner label="Starting" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.mustChangePassword && loc.pathname !== '/profile')
    return <Navigate to="/profile" replace state={{ forced: true }} />;
  if (permission && !can(permission)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}

export const homeFor = (can: (p: string) => boolean) =>
  can('reports.read') ? '/' : can('sales.create') ? '/pos' : '/notifications';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
          <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button variant="outline" onClick={() => window.location.assign('/')}>
              Go to start
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
