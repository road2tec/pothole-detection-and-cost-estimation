import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Info } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Notice } from '@/components/ui/display';
import { Logo } from '@/layouts/PublicLayout';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-[13px] text-muted">{footer}</div>}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-graphite-900 lg:block">
        <img src="/images/validation_0_annotated.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-graphite-950 via-graphite-950/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-12 text-white">
          <p className="max-w-md text-xl font-medium leading-snug">“Every pothole stored with its photograph, measured size, cost and repair status.”</p>
          <p className="mt-3 text-sm text-[#b8bdc4]">Real detection by the pretrained model used in this application.</p>
        </div>
      </div>
    </div>
  );
}

const loginSchema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed'));
    }
  });

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use the account approved by your administrator."
      footer={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-accent-strong hover:underline">
            Request access
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[13px] font-medium text-accent-strong hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

const password = z
  .string()
  .min(10, 'At least 10 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and numbers');

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name'),
    email: z.string().trim().email('Enter a valid email'),
    role: z.enum(['inspector', 'engineer']),
    office: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(30).optional(),
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export function RegisterPage() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', role: 'inspector', office: '', phone: '', password: '', confirm: '' },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async ({ confirm: _c, ...values }) => {
    setError(null);
    try {
      const r = await api.post('/auth/register', values);
      setDone(r.data.message);
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
    }
  });

  if (done) {
    return (
      <AuthShell title="Request received">
        <Notice tone="ok" icon={<CheckCircle2 />} title="Awaiting approval">
          {done}
        </Notice>
        <Button className="mt-6 w-full" variant="secondary" asChild>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Request access"
      subtitle="An administrator approves every account before first sign-in."
      footer={
        <>
          Already approved?{' '}
          <Link to="/login" className="font-medium text-accent-strong hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Full name" required error={e.name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}
        </Field>
        <Field label="Work email" required error={e.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        <Field label="Role" required error={e.role?.message} hint="Administrator accounts are created by an existing administrator.">
          {(p) => (
            <Select {...p} {...form.register('role')}>
              <option value="inspector">Field Inspector</option>
              <option value="engineer">Road Engineer</option>
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Office / division" error={e.office?.message}>
            {(p) => <Input {...p} {...form.register('office')} />}
          </Field>
          <Field label="Phone" error={e.phone?.message}>
            {(p) => <Input {...p} type="tel" autoComplete="tel" {...form.register('phone')} />}
          </Field>
        </div>
        <Field label="Password" required error={e.password?.message} hint="At least 10 characters with letters and numbers.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <Field label="Confirm password" required error={e.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('confirm')} />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Submit request
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [result, setResult] = useState<{ message: string; emailConfigured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email') })), defaultValues: { email: '' } });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      setResult((await api.post('/auth/forgot-password', values)).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <AuthShell title="Reset your password" subtitle="We'll email a link that is valid for 30 minutes." footer={<Link to="/login" className="font-medium text-accent-strong hover:underline">Back to sign in</Link>}>
      {result ? (
        <Notice tone={result.emailConfigured ? 'ok' : 'warn'} icon={result.emailConfigured ? <CheckCircle2 /> : <Info />}>
          {result.message}
        </Notice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async ({ password: pw }) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <AuthShell title="Choose a new password">
      {!token ? (
        <Notice tone="danger">This reset link is incomplete. Request a new one from the sign-in page.</Notice>
      ) : done ? (
        <>
          <Notice tone="ok" icon={<CheckCircle2 />}>
            Password updated. All other sessions were signed out.
          </Notice>
          <Button className="mt-6 w-full" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="New password" error={form.formState.errors.password?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('confirm')} />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
