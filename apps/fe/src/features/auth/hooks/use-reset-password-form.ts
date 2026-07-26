import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';

export function useResetPasswordForm() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const t = (id: string) => intl.formatMessage({ id: `auth.resetPassword.${id}` });

  const trimmed = password.trim();
  const requirements = [
    { key: 'minLength', met: trimmed.length >= 8 },
    { key: 'uppercase', met: /[A-Z]/.test(trimmed) },
    { key: 'numberOrSpecial', met: /[0-9!@#$%^&*]/.test(trimmed) },
  ];

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (trimmedPassword !== trimmedConfirm) {
      setError(t('error.mismatch'));
      return;
    }

    if (!requirements.every((r) => r.met)) {
      setError(t('error.tooShort'));
      return;
    }

    if (!token) {
      setError(t('error.generic'));
      return;
    }

    setIsLoading(true);

    const { error: authError } = await authClient.resetPassword({
      newPassword: trimmedPassword,
      token,
    });

    if (authError) {
      setError(authError.message || t('error.generic'));
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setIsLoading(false);
    setTimeout(() => {
      navigate('/login');
    }, 3000);
  };

  return {
    /** Truthy only when the URL carries `?token=...` from the email
     *  link. Component uses this to render an "invalid access" card
     *  instead of the password form when someone lands on
     *  /reset-password directly. */
    hasToken: token.length > 0,
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
  };
}
