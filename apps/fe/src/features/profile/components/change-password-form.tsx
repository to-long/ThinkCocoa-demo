import { type ChangePasswordInput, changePasswordSchema } from '@cocoaimpact/shared';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { authClient } from '@/lib/auth-client';
import { useApiSuccessToast } from '@/shared/api';

const VALIDATOR_CODE_RE = /^[A-Z][A-Z0-9_]*$/;

export function ChangePasswordForm() {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  // The shared `changePasswordSchema` emits validator codes
  // (`PASSWORD_CURRENT_REQUIRED`, `PASSWORD_MIN_LENGTH`,
  // `PASSWORD_MISMATCH`, …). Translate them here so the inline error
  // shows a localized message instead of the raw code.
  const tr = (msg?: string) => {
    if (!msg) return undefined;
    const id = VALIDATOR_CODE_RE.test(msg) ? `validator.${msg}` : msg;
    return intl.formatMessage({ id, defaultMessage: msg });
  };

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const successToast = useApiSuccessToast();

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (data: ChangePasswordInput) => {
    setSuccess('');
    setError('');

    const { error: authError } = await authClient.changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      revokeOtherSessions: false,
    });

    if (authError) {
      setError(authError.message || t('profile.changePassword.error.generic'));
      return;
    }

    setSuccess(t('profile.changePassword.success'));
    successToast({ message: t('profile.changePassword.success') });
    form.reset();
  };

  return (
    // Same compact overrides as AccountInfoForm: py-4 gap-3 on the
    // Card, px-4 on Header / Content / Footer.
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="font-semibold text-base">
          {t('profile.changePassword.title')}
        </CardTitle>
        <CardDescription>{t('profile.changePassword.description')}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <form
          id="password-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currentPassword">{t('profile.changePassword.currentPassword')}</Label>
            <PasswordInput
              id="currentPassword"
              placeholder="••••••••"
              {...form.register('currentPassword')}
            />
            {form.formState.errors.currentPassword && (
              <p className="text-destructive text-xs">
                {tr(form.formState.errors.currentPassword.message)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newPassword">{t('profile.changePassword.newPassword')}</Label>
            <PasswordInput
              id="newPassword"
              placeholder="••••••••"
              {...form.register('newPassword')}
            />
            {form.formState.errors.newPassword && (
              <p className="text-destructive text-xs">
                {tr(form.formState.errors.newPassword.message)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">{t('profile.changePassword.confirmPassword')}</Label>
            <PasswordInput
              id="confirmPassword"
              placeholder="••••••••"
              {...form.register('confirmPassword')}
            />
            {form.formState.errors.confirmPassword && (
              <p className="text-destructive text-xs">
                {tr(form.formState.errors.confirmPassword.message)}
              </p>
            )}
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}
        </form>
      </CardContent>
      <CardFooter className="px-4 py-3">
        <Button type="submit" form="password-form" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? t('profile.changePassword.submitting')
            : t('profile.changePassword.submit')}
        </Button>
      </CardFooter>
    </Card>
  );
}
