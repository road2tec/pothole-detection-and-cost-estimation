import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, CheckCheck, KeyRound, Save } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { Notification, Paged } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card, CardBody, CardHeader, DefinitionList, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/display';

function NotificationsView() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['notifications', page], queryFn: async () => (await api.get<Paged<Notification> & { unread: number }>('/notifications', { params: { page, limit: 20 } })).data });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Processing results, review requests and account updates."
        actions={
          <Button variant="secondary" onClick={() => markRead.mutate(undefined)} disabled={!q.data?.unread}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Card>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Bell />} title="No notifications yet" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data.items.map((n) => (
                <li key={n._id}>
                  <button
                    className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[#faf9f6]"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate([n._id]);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-accent'}`} aria-label={n.readAt ? undefined : 'Unread'} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-[13.5px] ${n.readAt ? 'text-ink-2' : 'font-medium text-ink'}`}>{n.title}</div>
                      {n.message && <div className="text-[13px] text-muted">{n.message}</div>}
                    </div>
                    <span className="shrink-0 text-xs text-muted">{fmt.relative(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

function ProfileView() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ name: user!.name, office: user!.office ?? '', phone: user!.phone ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const saveProfile = useMutation({
    mutationFn: () => api.patch('/auth/me', profile),
    onSuccess: (r) => {
      setUser(r.data.user);
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: async () => {
      toast.success('Password changed — please sign in again');
      await logout();
      navigate('/login');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pwMismatch = pw.confirm !== '' && pw.confirm !== pw.newPassword;
  return (
    <>
      <PageHeader title="Profile & security" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="space-y-4">
            <DefinitionList items={[['Email', user!.email], ['Role', label('role', user!.role)], ['Last sign-in', fmt.dateTime(user!.lastLoginAt)]]} />
            <Field label="Full name">{(p) => <Input {...p} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Office">{(p) => <Input {...p} value={profile.office} onChange={(e) => setProfile({ ...profile, office: e.target.value })} />}</Field>
              <Field label="Phone">{(p) => <Input {...p} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />}</Field>
            </div>
            <Button onClick={() => saveProfile.mutate()} loading={saveProfile.isPending} disabled={profile.name.trim().length < 2}>
              <Save /> Save profile
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" description="All sessions are signed out after a change." />
          <CardBody className="space-y-4">
            <Field label="Current password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" hint="10+ characters with letters and numbers">{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
            <Field label="Confirm new password" error={pwMismatch ? 'Passwords do not match' : undefined}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
            <Button onClick={() => changePw.mutate()} loading={changePw.isPending} disabled={!pw.currentPassword || pw.newPassword.length < 10 || pwMismatch || !pw.confirm}>
              <KeyRound /> Change password
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

const HELP: Array<[string, string[]]> = [
  [
    'Uploading',
    [
      'Accepted: JPG/PNG photographs and MP4 survey videos. Size limits are set by your administrator.',
      'GPS is read from photo EXIF when present; you can also type coordinates. Video potholes get GPS only from a GPX track.',
      'Detection runs in the background. Progress appears on the upload page and in Uploads & jobs.',
    ],
  ],
  [
    'Measurements',
    [
      '“Not calibrated” means no scale exists. Open the upload → Calibrate → click both ends of a reference object and enter its length.',
      'Depth from the AI model is relative. Enter a measured depth (ruler) on the pothole page to get volume, severity and cost.',
      'Manual values are recorded as measured, with your reason, and survive recalibration.',
    ],
  ],
  [
    'Costs',
    [
      'C = V × (material + labour) + mobilisation. Mobilisation is added once per repair visit in budgets.',
      'Each estimate stores the cost-configuration version used. Administrators can recalculate open records after a rate change.',
      'Unmeasured potholes are excluded from totals — their cost is unknown, not zero.',
    ],
  ],
  [
    'Troubleshooting',
    [
      '“AI service offline”: start the Python service (see README). Queued uploads are processed automatically once it is ready.',
      'Upload failed: open it and use Retry. The error message explains why (e.g. corrupt video, unsupported codec).',
      'Map is empty: only records with real coordinates are plotted; check the notice above the map for unlocated records.',
      'Signed out unexpectedly: sessions end after 7 days of inactivity, on password change, or if an administrator changes your role.',
    ],
  ],
];

function HelpView() {
  return (
    <>
      <PageHeader title="Help & troubleshooting" description="Short answers for everyday tasks. Full documentation is in the project's docs folder." />
      <div className="grid gap-6 lg:grid-cols-2">
        {HELP.map(([title, items]) => (
          <Card key={title}>
            <CardHeader title={title} />
            <CardBody>
              <ul className="space-y-2.5 text-[13.5px] leading-relaxed text-ink-2">
                {items.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                    {t}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-[13px] text-muted">
        See also <Link to="/methodology" className="font-medium text-accent-strong underline">AI methodology</Link> for model details and limitations.
      </p>
    </>
  );
}

export default function AccountPages({ view }: { view: 'notifications' | 'profile' | 'help' }) {
  if (view === 'notifications') return <NotificationsView />;
  if (view === 'profile') return <ProfileView />;
  return <HelpView />;
}
