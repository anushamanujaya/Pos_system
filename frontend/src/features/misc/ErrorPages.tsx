import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { homeFor } from '@/components/layout/guards';
import { useAuth } from '@/stores/auth';

function Page({ code, title, text }: { code: string; title: string; text: string }) {
  const can = useAuth((s) => s.can);
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div className="space-y-3">
        <p className="text-5xl font-semibold text-primary">{code}</p>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
        <Button asChild>
          <Link to={homeFor(can)}>Back to start</Link>
        </Button>
      </div>
    </div>
  );
}
export const NotFoundPage = () => (
  <Page code="404" title="Page not found" text="The page you are looking for does not exist or has moved." />
);
export const UnauthorizedPage = () => (
  <Page
    code="403"
    title="Not authorised"
    text={useAuth.getState().user?.role === 'DEMO'
      ? 'This action is unavailable in Demo Mode. You can explore sample data and run test sales.'
      : 'Your role does not have access to this area. Ask an administrator if you need it.'}
  />
);
