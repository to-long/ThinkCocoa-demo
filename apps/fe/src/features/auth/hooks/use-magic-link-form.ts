import { useState } from 'react';
import { useIntl } from 'react-intl';
import { authClient } from '@/lib/auth-client';

export function useMagicLinkForm() {
  const intl = useIntl();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id: `auth.magicLink.${id}` }, values);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    setIsLoading(true);
    setError('');

    const { error: authError } = await authClient.signIn.magicLink({
      email: trimmedEmail,
      callbackURL: '/',
    });

    if (authError) {
      setError(authError.message || t('error.generic'));
      setIsLoading(false);
      return;
    }

    setSent(true);
    setIsLoading(false);
  };

  return {
    email,
    setEmail,
    isLoading,
    sent,
    error,
    handleSubmit,
    t,
  };
}
