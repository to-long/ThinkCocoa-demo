import { WandSparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMagicLinkForm } from '../hooks/use-magic-link-form';

export function MagicLinkForm() {
  const { email, setEmail, isLoading, sent, error, handleSubmit, t } = useMagicLinkForm();

  if (sent) {
    return (
      <Card className="w-full max-w-[392px]">
        <CardHeader className="gap-2 px-6 pt-6 pb-4">
          <CardTitle className="font-['Space_Grotesk'] font-semibold text-2xl">
            {t('success.title')}
          </CardTitle>
          <CardDescription className="leading-snug">
            {t('success.description', { email })}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="flex justify-center pt-2">
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
            <WandSparkles className="size-4" />
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
