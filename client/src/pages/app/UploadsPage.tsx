import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileVideo, ImageIcon, RotateCcw, Upload as UploadIcon } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { Paged, Upload } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/display';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { JobStatusBadge, ProgressBar } from '@/components/domain';

export default function UploadsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? '';
  const kind = params.get('kind') ?? '';
  const mine = params.get('mine') ?? '';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['uploads', { page, status, kind, mine }],
    queryFn: async () => (await api.get<Paged<Upload>>('/uploads', { params: { page, limit: 20, status: status || undefined, kind: kind || undefined, mine: mine || undefined } })).data,
    refetchInterval: (query) => (query.state.data?.items.some((u) => u.status === 'queued' || u.status === 'processing') ? 3000 : false),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/uploads/${id}/retry`),
    onSuccess: () => {
      toast.success('Queued for another attempt');
      qc.invalidateQueries({ queryKey: ['uploads'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Uploads & processing jobs"
        description={user!.role === 'inspector' ? 'Your uploads and their detection progress.' : 'All uploads. Failed jobs can be retried without uploading again.'}
        actions={
          <Button asChild>
            <Link to="/app/upload">
              <UploadIcon /> New upload
            </Link>
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
          <div className="space-y-1">
            <Label htmlFor="u-status">Status</Label>
            <Select id="u-status" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="u-kind">Type</Label>
            <Select id="u-kind" value={kind} onChange={(e) => setParam('kind', e.target.value)}>
              <option value="">All</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </Select>
          </div>
          {user!.role !== 'inspector' && (
            <div className="space-y-1">
              <Label htmlFor="u-mine">Uploaded by</Label>
              <Select id="u-mine" value={mine} onChange={(e) => setParam('mine', e.target.value)}>
                <option value="">Anyone</option>
                <option value="true">Me</option>
              </Select>
            </div>
          )}
        </div>
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<UploadIcon />} title="No uploads match" description="Change the filters or upload new survey material." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>File</Th>
                  <Th>Location</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Potholes</Th>
                  <Th>Uploaded</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {q.data.items.map((u) => (
                  <Tr key={u._id}>
                    <Td>
                      <Link to={`/app/uploads/${u._id}`} className="flex items-center gap-2.5 font-medium text-ink hover:underline">
                        {u.kind === 'video' ? <FileVideo className="size-4 text-muted" /> : <ImageIcon className="size-4 text-muted" />}
                        <span className="max-w-[220px] truncate">{u.originalName}</span>
                      </Link>
                      <div className="num mt-0.5 pl-6 text-xs text-muted">{fmt.bytes(u.sizeBytes)}</div>
                    </Td>
                    <Td>
                      <div className="text-ink">{u.roadName ?? '—'}</div>
                      <div className="text-xs text-muted">{[u.locality, u.ward].filter(Boolean).join(' · ') || 'No locality'}</div>
                    </Td>
                    <Td className="min-w-[180px]">
                      <JobStatusBadge status={u.status} />
                      {(u.status === 'queued' || u.status === 'processing') && u.job && (
                        <>
                          <ProgressBar value={u.job.progress} className="mt-2" />
                          <div className="mt-1 text-xs text-muted">{u.job.stage}</div>
                        </>
                      )}
                      {u.status === 'failed' && <div className="mt-1 max-w-[260px] text-xs text-danger">{u.error}</div>}
                    </Td>
                    <Td className="num text-right">
                      {u.status === 'completed' ? (
                        <>
                          <div className="font-medium text-ink">{u.uniquePotholeCount}</div>
                          {u.kind === 'video' && <div className="text-xs text-muted">{u.detectionCount} frame det.</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <div className="text-ink-2">{fmt.relative(u.createdAt)}</div>
                      {typeof u.uploadedBy === 'object' && <div className="text-xs text-muted">{u.uploadedBy.name}</div>}
                    </Td>
                    <Td className="text-right">
                      {u.status === 'failed' ? (
                        <Button size="sm" variant="secondary" onClick={() => retry.mutate(u._id)} loading={retry.isPending && retry.variables === u._id}>
                          <RotateCcw /> Retry
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={`/app/uploads/${u._id}`}>Open</Link>
                        </Button>
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
    </>
  );
}
