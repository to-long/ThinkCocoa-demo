import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';

export function useLoginForm() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const t = (id: string) => intl.formatMessage({ id: `auth.login.${id}` });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedEmail || !trimmedPassword) return;

    setIsSubmitting(true);
    setError('');

    const { error: authError } = await authClient.signIn.email({
      email: trimmedEmail,
      password: trimmedPassword,
    });

    if (authError) {
      // Soft-deleted accounts are blocked at session creation (see
      // auth.ts databaseHooks) with code ACCOUNT_DELETED → show the
      // dedicated "contact admin" message instead of the generic one.
      if (authError.code === 'ACCOUNT_DELETED') {
        setError(t('error.accountDeleted'));
      } else {
        setError(authError.message || t('error.generic'));
      }
      setIsSubmitting(false);
      return;
    }

    navigate('/');
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    isSubmitting,
    error,
    handleSubmit,
    navigate,
    t,
  };
}
