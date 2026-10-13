import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, MoreHorizontal, Pencil, Plus, Search, UserX, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { Paged, Role, User } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/display';
import { Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlay';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

const STATUS_TONE = { pending: 'accent', active: 'ok', rejected: 'danger', deactivated: 'neutral' } as const;

function UserDialog({ user, onClose }: { user: User | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = user === 'new';
  const [form, setForm] = useState({ name: isNew ? '' : user.name, email: isNew ? '' : user.email, role: (isNew ? 'inspector' : user.role) as Role, office: isNew ? '' : user.office ?? '', phone: isNew ? '' : user.phone ?? '', password: '' });
  const m = useMutation({
    mutationFn: (): Promise<unknown> => {
      const { email, password, ...rest } = form;
      if (isNew) return api.post('/users', { ...rest, email, password });
      return api.patch(`/users/${user.id}`, { ...rest, password: password || undefined });
    },
    onSuccess: () => {
      toast.success(isNew ? 'User created' : 'User updated');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Create user' : `Edit ${user.name}`}
      description={isNew ? 'Accounts created here are active immediately.' : 'Changing role or password signs the user out of all sessions.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2">
          {(p) => <Input {...p} value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" required className="sm:col-span-2">
          {(p) => <Input {...p} type="email" value={form.email} onChange={set('email')} disabled={!isNew} />}
        </Field>
        <Field label="Role" required>
          {(p) => (
            <Select {...p} value={form.role} onChange={set('role')}>
              <option value="inspector">Field Inspector</option>
              <option value="engineer">Road Engineer</option>
              <option value="admin">Administrator</option>
            </Select>
          )}
        </Field>
        <Field label="Office">{(p) => <Input {...p} value={form.office} onChange={set('office')} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} value={form.phone} onChange={set('phone')} />}</Field>
        <Field label={isNew ? 'Initial password' : 'Reset password'} required={isNew} hint="10+ characters with letters and numbers">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
      </div>
    </Dialog>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const role = params.get('role') ?? '';
  const qText = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const q = useQuery({ queryKey: ['users', { status, role, qText, page }], queryFn: async () => (await api.get<Paged<User>>('/users', { params: { status: status || undefined, role: role || undefined, q: qText || undefined, page, limit: 20 } })).data });
  const setStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => api.patch(`/users/${id}/status`, { status: s }),
    onSuccess: (_d, v) => {
      toast.success(`User ${v.s === 'active' ? 'activated' : v.s}`);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Approve registrations, assign roles and manage account access. All changes are written to the audit log."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Create user
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input aria-label="Search users" placeholder="Search name, email, office…" className="pl-9" defaultValue={qText} onKeyDown={(e) => e.key === 'Enter' && setParam('q', (e.target as HTMLInputElement).value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="us">Status</Label>
            <Select id="us" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending approval</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ur">Role</Label>
            <Select id="ur" value={role} onChange={(e) => setParam('role', e.target.value)}>
              <option value="">All</option>
              <option value="admin">Administrator</option>
              <option value="engineer">Road Engineer</option>
              <option value="inspector">Field Inspector</option>
            </Select>
          </div>
        </div>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState title="No users match" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Office</Th>
                  <Th>Status</Th>
                  <Th>Last sign-in</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </THead>
              <TBody>
                {q.data.items.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <div className="font-medium text-ink">
                        {u.name}
                        {u.id === me!.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                      </div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </Td>
                    <Td>{label('role', u.role)}</Td>
                    <Td>{u.office || '—'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[u.status]}>{u.status === 'pending' ? 'Pending approval' : u.status[0].toUpperCase() + u.status.slice(1)}</Badge>
                    </Td>
                    <Td>{u.lastLoginAt ? fmt.relative(u.lastLoginAt) : 'Never'}</Td>
                    <Td className="text-right">
                      {u.status === 'pending' ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" onClick={() => setStatus.mutate({ id: u.id, s: 'active' })}>
                            <Check /> Approve
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: u.id, s: 'rejected' })}>
                            <X /> Reject
                          </Button>
                        </div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(u)}>
                              <Pencil /> Edit / change role
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {u.status === 'active' ? (
                              <DropdownMenuItem disabled={u.id === me!.id} onSelect={() => setStatus.mutate({ id: u.id, s: 'deactivated' })}>
                                <UserX /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => setStatus.mutate({ id: u.id, s: 'active' })}>
                                <Check /> Activate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} onPage={(p) => setParam('page', String(p))} />
          </>
        )}
      </Card>
      {editing && <UserDialog user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
