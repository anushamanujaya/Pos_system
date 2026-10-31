import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '@/components/shared/bits';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { errMsg, send } from '@/lib/api';
import { useAuth, type SessionUser } from '@/stores/auth';

const pwSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Za-z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ProfilePage() {
  const { user, setUser, setSession } = useAuth();
  const forced = (useLocation().state as { forced?: boolean } | null)?.forced || user?.mustChangePassword;
  const profile = useForm<{ name: string; phone: string }>({
    defaultValues: { name: user?.name ?? '', phone: user?.phone ?? '' },
  });
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="My profile"
        description={user?.email}
        actions={<Badge tone="primary">{user?.role}</Badge>}
      />
      {forced && (
        <div role="alert" className="mb-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
          Your password was set by an administrator. Please choose a new password to continue.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              className="space-y-4"
              onSubmit={profile.handleSubmit(async (v) => {
                try {
                  const r = await send<SessionUser>('patch', '/auth/profile', v);
                  setUser(r.data);
                  toast.success('Profile updated');
                } catch (e) {
                  toast.error(errMsg(e));
                }
              })}
            >
              <Field label="Name">
                <Input {...profile.register('name', { required: true })} />
              </Field>
              <Field label="Phone">
                <Input {...profile.register('phone')} />
              </Field>
              <Button type="submit" loading={profile.formState.isSubmitting}>
                Save
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              className="space-y-4"
              noValidate
              onSubmit={pw.handleSubmit(async (v) => {
                try {
                  const r = await send<{ accessToken: string; user: SessionUser }>(
                    'post',
                    '/auth/change-password',
                    { currentPassword: v.currentPassword, newPassword: v.newPassword },
                  );
                  setSession(r.data.accessToken, r.data.user);
                  pw.reset();
                  toast.success('Password changed. Other devices were signed out.');
                } catch (e) {
                  toast.error(errMsg(e));
                }
              })}
            >
              <Field label="Current password" error={pw.formState.errors.currentPassword?.message}>
                <Input type="password" autoComplete="current-password" {...pw.register('currentPassword')} />
              </Field>
              <Field
                label="New password"
                error={pw.formState.errors.newPassword?.message}
                hint="8+ characters with letters and numbers"
              >
                <Input type="password" autoComplete="new-password" {...pw.register('newPassword')} />
              </Field>
              <Field label="Confirm new password" error={pw.formState.errors.confirm?.message}>
                <Input type="password" autoComplete="new-password" {...pw.register('confirm')} />
              </Field>
              <Button type="submit" loading={pw.formState.isSubmitting}>
                Change password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
