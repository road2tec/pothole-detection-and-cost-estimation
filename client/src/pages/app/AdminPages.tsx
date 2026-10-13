import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Briefcase, RotateCcw, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { Paged } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/display';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { JobStatusBadge, ProgressBar } from '@/components/domain';

function useParam() {
  const [params, setParams] = useSearchParams();
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n, { replace: true });
  };
  return { params, set };
}

function JobsView() {
  const { params, set } = useParam();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['jobs', { status, page }],
    queryFn: async () => (await api.get<Paged<any> & { counts: Record<string, number> }>('/jobs', { params: { status: status || undefined, page, limit: 20 } })).data,
    refetchInterval: 5000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      toast.success('Job re-queued');
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Processing jobs" description="Background detection jobs (MongoDB-backed queue). Failed jobs keep their error and can be retried without re-uploading." />
      <div className="mb-4 flex flex-wrap gap-2">
        {['queued', 'running', 'completed', 'failed'].map((s) => (
          <button key={s} onClick={() => set('status', status === s ? '' : s)} className={`rounded-full border px-3 py-1 text-[13px] ${status === s ? 'border-graphite-900 bg-graphite-900 text-white' : 'border-line bg-surface text-ink-2 hover:bg-subtle'}`}>
            {s[0].toUpperCase() + s.slice(1)} <span className="num ml-1 opacity-70">{q.data?.counts?.[s] ?? 0}</span>
          </button>
        ))}
      </div>
      <Card>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Briefcase />} title="No jobs" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Upload</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th>Error</Th>
                  <Th>Created</Th>
                  <Th />
                </tr>
              </THead>
              <TBody>
                {q.data.items.map((j) => (
                  <Tr key={j._id}>
                    <Td>
                      {j.upload ? (
                        <Link to={`/app/uploads/${j.upload._id}`} className="font-medium text-ink hover:underline">
                          {j.upload.originalName}
                        </Link>
                      ) : (
                        'Deleted upload'
                      )}
                      <div className="text-xs text-muted">{j.upload?.uploadedBy?.name}</div>
                    </Td>
                    <Td>{j.type === 'detect-video' ? 'Video' : 'Image'}</Td>
                    <Td className="min-w-[160px]">
                      <JobStatusBadge status={j.status} />
                      {j.status === 'running' && <ProgressBar value={j.progress} className="mt-2" />}
                      {j.stage && <div className="mt-1 text-xs text-muted">{j.stage}</div>}
                    </Td>
                    <Td className="num">
                      {j.attempts}/{j.maxAttempts}
                    </Td>
                    <Td className="max-w-[280px] text-xs text-danger">
                      {j.errorCode && <Badge tone="danger" className="mb-1">{j.errorCode}</Badge>}
                      <div>{j.error}</div>
                    </Td>
                    <Td>{fmt.relative(j.createdAt)}</Td>
                    <Td className="text-right">
                      {(j.status === 'failed' || j.status === 'cancelled') && (
                        <Button size="sm" variant="secondary" onClick={() => retry.mutate(j._id)} loading={retry.isPending && retry.variables === j._id}>
                          <RotateCcw /> Retry
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </Card>
    </>
  );
}

function AuditView() {
  const { params, set } = useParam();
  const page = Number(params.get('page') ?? 1);
  const entity = params.get('entity') ?? '';
  const action = params.get('action') ?? '';
  const q = useQuery({
    queryKey: ['audit', { page, entity, action }],
    queryFn: async () => (await api.get<Paged<any>>('/audit-logs', { params: { page, limit: 30, entity: entity || undefined, action: action || undefined } })).data,
  });
  return (
    <>
      <PageHeader title="Audit log" description="Who changed what and when — accounts, uploads, measurements, reviews, configuration and exports." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
          <div className="space-y-1">
            <Label htmlFor="ae">Entity</Label>
            <Select id="ae" value={entity} onChange={(e) => set('entity', e.target.value)}>
              <option value="">All</option>
              {['User', 'Upload', 'Pothole', 'Calibration', 'CameraProfile', 'CostConfiguration', 'SystemSetting', 'RepairVisit', 'Report', 'AnalyticsExportJob', 'ApiKey', 'ProcessingJob', 'PowerBI'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="aa">Action starts with</Label>
            <Input id="aa" defaultValue={action} placeholder="e.g. pothole.review" onKeyDown={(e) => e.key === 'Enter' && set('action', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<ShieldCheck />} title="No audit entries" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Details</Th>
                </tr>
              </THead>
              <TBody>
                {q.data.items.map((a) => (
                  <Tr key={a._id}>
                    <Td className="whitespace-nowrap">{fmt.dateTime(a.createdAt)}</Td>
                    <Td>{a.userEmail ?? 'System'}</Td>
                    <Td className="font-mono text-xs text-ink">{a.action}</Td>
                    <Td className="text-xs">
                      {a.entity}
                      {a.entityId && <div className="font-mono text-faint">…{String(a.entityId).slice(-8)}</div>}
                    </Td>
                    <Td className="max-w-[420px]">
                      {a.details && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted">View</summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-subtle p-2 font-mono text-[11px] text-ink-2">{JSON.stringify(a.details, null, 2)}</pre>
                        </details>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </Card>
    </>
  );
}

export default function AdminPages({ view }: { view: 'jobs' | 'audit' }) {
  return view === 'jobs' ? <JobsView /> : <AuditView />;
}
