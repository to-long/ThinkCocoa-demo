import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForgotPasswordForm } from '../hooks/use-forgot-password-form';

export function ForgotPasswordForm() {
  const { email, setEmail, isLoading, sent, setSent, error, handleSubmit, t } =
    useForgotPasswordForm();

  if (sent) {
    return (
      <Card className="w-full max-w-[392px]">
        <CardHeader className="gap-2 px-6 pt-6 pb-4">
          <CardTitle className="font-semibold text-2xl">{t('checkEmail.title')}</CardTitle>
          <CardDescription className="leading-snug">
            {t('checkEmail.description', { email })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6 pb-6">
          <p className="text-muted-foreground text-sm">{t('checkEmail.noEmail')}</p>
          {/* No "Enter Reset Code" affordance here — the reset page
              only accepts a signed `?token=` from the email link;
              landing there manually with an empty form would let
              the user type a new password against no user context.
              Force the flow through the emailed link. */}
          <Button variant="ghost" className="w-full" onClick={() => setSent(false)}>
            {t('checkEmail.tryAgain')}
          </Button>
          <div className="flex justify-center pt-1">
            <Link to="/login" className="font-medium text-muted-foreground text-xs hover:underline">
              {t('backToSignIn')}
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-[392px]">
      <CardHeader className="gap-2 px-6 pt-6 pb-4">
        <CardTitle className="font-['Space_Grotesk'] font-semibold text-2xl">
          {t('title')}
        </CardTitle>
        <CardDescription className="leading-snug">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="px-6 pt-2">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? t('submitting') : t('submit')}
          </Button>
        </form>
      </CardContent>
      <div className="flex justify-center">
        <Link to="/login" className="font-medium text-muted-foreground text-xs hover:underline">
          {t('backToSignIn')}
        </Link>
      </div>
    </Card>
  );
}
