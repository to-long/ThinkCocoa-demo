import { zodResolver } from '@hookform/resolvers/zod';
import { type UpdateProfileInput, updateProfileSchema } from '@thinkcocoa/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { useApiSuccessToast } from '@/shared/api';

const VALIDATOR_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

export function AccountInfoForm() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  // Translate validator codes (`NAME_REQUIRED`, `TEXT_TOO_LONG`, …)
  // emitted by the shared schema. Falls back to the raw string for
  // anything else (auth errors, custom messages).
  const tr = (msg?: string) => {
    if (!msg) return undefined;
    const id = VALIDATOR_CODE_RE.test(msg) ? `validator.${msg}` : msg;
    return intl.formatMessage({ id, defaultMessage: msg });
  };

  const { data: session, refetch } = authClient.useSession();
  const user = session?.user;

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const successToast = useApiSuccessToast();

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user?.name ?? '' },
  });

  const onSubmit = async (data: UpdateProfileInput) => {
    setSuccess('');
    setError('');

    const { error: authError } = await authClient.updateUser({
      name: data.name,
    });

    if (authError) {
      setError(authError.message || t('profile.accountInfo.error.generic'));
      return;
    }

    setSuccess(t('profile.accountInfo.success'));
    successToast({ message: t('profile.accountInfo.success') });
    refetch();
  };

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="font-semibold text-base">{t('profile.accountInfo.title')}</CardTitle>
        <CardDescription>{t('profile.accountInfo.description')}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <form
          id="profile-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className="text-muted-foreground text-xs">
              {t('profile.accountInfo.name')}
            </Label>
            <Input id="name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-destructive text-xs">{tr(form.formState.errors.name.message)}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t('profile.accountInfo.email')}</span>
            <span className="font-medium text-sm text-foreground">{user?.email ?? ''}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t('profile.accountInfo.roles')}</span>
            <div className="flex gap-2">
              <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground text-xs">
                Super Admin
              </span>
            </div>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}
        </form>
      </CardContent>
      <CardFooter className="px-4 py-3">
        <Button type="submit" form="profile-form" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? t('profile.accountInfo.submitting')
            : t('profile.accountInfo.submit')}
        </Button>
      </CardFooter>
    </Card>
  );
}
