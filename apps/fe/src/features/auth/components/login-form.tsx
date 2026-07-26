import { Eye, EyeOff, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useLoginForm } from '../hooks/use-login-form';

export function LoginForm() {
  const { email, setEmail, password, setPassword, isSubmitting, error, handleSubmit, t } =
    useLoginForm();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card className="w-full max-w-[392px]">
      <CardHeader className="gap-2 px-6 pt-6 pb-4">
        <CardTitle className="font-['Space_Grotesk'] font-semibold text-2xl">
          {t('title')}
        </CardTitle>
        <CardDescription className="leading-snug">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="px-6 pt-2 pb-6">
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
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('password')}</Label>
              <Link
                to="/forgot-password"
                tabIndex={-1}
                className="font-medium text-muted-foreground text-xs hover:underline"
              >
                {t('forgotPassword')}
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder={t('passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-muted-foreground text-xs">{t('or')}</span>
            <Separator className="flex-1" />
          </div>
          <Button type="button" variant="outline" className="w-full" asChild>
            <Link to="/magic-link">
              <WandSparkles className="size-4" />
              {t('sendMagicLink')}
            </Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
