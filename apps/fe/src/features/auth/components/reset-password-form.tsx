import { Check, CircleCheck, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useResetPasswordForm } from '../hooks/use-reset-password-form';

export function ResetPasswordForm() {
  const {
    hasToken,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isLoading,
    error,
    success,
    showPassword,
    setShowPassword,
    showConfirmPassword,
    setShowConfirmPassword,
    requirements,
    handleResetPassword,
    t,
  } = useResetPasswordForm();

  // Gate BEFORE the form ever renders. `/reset-password` without a
  // `?token=` in the URL means the user landed here without going
  // through the emailed link — the reset endpoint would reject the
  // submit anyway, but a blank form invites confusion. Show an
  // access-denied card that points back to the request flow.
  if (!hasToken) {
    return (
      <Card className="w-full max-w-[392px]">
        <CardHeader className="gap-2 px-6 pt-6 pb-2">
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ShieldAlert className="size-6 text-foreground" />
            </div>
            <h1 className="text-center font-semibold text-2xl text-foreground">
              {t('invalidAccess.title')}
            </h1>
            <p className="text-center text-muted-foreground text-sm leading-[1.43]">
              {t('invalidAccess.description')}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-6 pb-6">
          <Button asChild className="w-full">
            <Link to="/forgot-password">{t('invalidAccess.requestLink')}</Link>
          </Button>
          <div className="flex justify-center">
            <Link to="/login" className="font-medium text-muted-foreground text-xs hover:underline">
              {t('backToSignIn')}
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (success) {
    return (
      <Card className="w-full max-w-[392px]">
        <CardHeader className="gap-2 px-6 pt-6 pb-2">
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <CircleCheck className="size-6 text-foreground" />
            </div>
            <h1 className="text-center font-semibold text-2xl text-foreground">
              {t('success.title')}
            </h1>
            <p className="text-center text-muted-foreground text-sm leading-[1.43]">
              {t('success.description')}
            </p>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="flex justify-center">
            <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-[392px]">
      <CardContent className="p-6">
        <div className="flex flex-col gap-6">
          {/* Header with icon */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <KeyRound className="size-6 text-foreground" />
            </div>
            <h1 className="text-center font-semibold text-2xl text-foreground">{t('title')}</h1>
            <p className="text-center text-muted-foreground text-sm leading-[1.43]">
              {t('description')}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t('newPassword')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('newPasswordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">{t('confirmPassword')}</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder={t('confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Password requirements */}
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-muted-foreground text-xs">
                {t('requirements.title')}
              </span>
              {requirements.map((req) => (
                <div key={req.key} className="flex items-center gap-1.5">
                  <Check
                    className={`size-3.5 ${req.met ? 'text-foreground' : 'text-muted-foreground/40'}`}
                  />
                  <span
                    className={`text-xs ${req.met ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {t(`requirements.${req.key}`)}
                  </span>
                </div>
              ))}
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('submitting') : t('submit')}
              </Button>
              <div className="flex justify-center">
                <Link
                  to="/login"
                  className="font-medium text-muted-foreground text-xs hover:underline"
                >
                  {t('backToSignIn')}
                </Link>
              </div>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
