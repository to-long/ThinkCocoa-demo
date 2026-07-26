import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../constants/index';
import { emailSchema, FIELD_LIMITS } from './common';
import { V } from './validator-error-code';

// Cap at 128 chars even for user-set passwords — bcrypt itself
// silently truncates anything longer, and the cap prevents DoS via
// gigabyte-scale password submissions hitting the hash function.
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, V.PASSWORD_MIN_LENGTH)
  .max(FIELD_LIMITS.password, V.PASSWORD_MAX_LENGTH);

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, V.NAME_REQUIRED).max(FIELD_LIMITS.fullName, V.TEXT_TOO_LONG),
});

export const signInSchema = z.object({
  email: emailSchema,
  // No max on sign-in password — let any historical-length password
  // attempt; the bcrypt comparison will simply fail. Tighter
  // constraints would lock out users mid-migration.
  password: z.string().min(1, V.PASSWORD_REQUIRED),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, V.PASSWORD_CURRENT_REQUIRED),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, V.PASSWORD_CONFIRM_REQUIRED),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: V.PASSWORD_MISMATCH,
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, V.PASSWORD_CONFIRM_REQUIRED),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: V.PASSWORD_MISMATCH,
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, V.NAME_REQUIRED).max(FIELD_LIMITS.fullName, V.TEXT_TOO_LONG),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
