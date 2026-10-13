import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  role: z.enum(['engineer', 'inspector']), // administrators are never self-registered
  office: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });

export const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  office: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
});
