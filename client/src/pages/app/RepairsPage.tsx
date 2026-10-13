import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList, IndianRupee, Plus, Trash2, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { Paged, Pothole, RepairVisit } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, DefinitionList, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, Pagination, Stat } from '@/components/ui/display';
import { Dialog } from '@/components/ui/overlay';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { MeasurementBadge, SeverityBadge } from '@/components/domain';

const VISIT_TONE = { planned: 'neutral', in_progress: 'info', completed: 'ok', cancelled: 'danger' } as const;

function VisitDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['repair-visit', id], queryFn: async () => (await api.get<{ visit: Omit<RepairVisit, 'potholes'> & { potholes: Pothole[] } }>(`/repair-visits/${id}`)).data.visit });
  const [actual, setActual] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/repair-visits/${id}`, body),
    onSuccess: () => {
      toast.success('Work order updated');
      qc.invalidateQueries({ queryKey: ['repair-visit', id] });
      qc.invalidateQueries({ queryKey: ['repair-visits'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['potholes'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const v = q.data;
  const open = v && (v.status === 'planned' || v.status === 'in_progress');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={v ? `${v.code} — ${v.title}` : 'Work order'} description={v ? `${v.potholes.length} pothole(s) · estimate uses cost configuration v${v.costConfigVersion ?? '—'}` : undefined} className="max-w-3xl">
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        v && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <DefinitionList
                items={[
                  ['Material', fmt.inr(v.materialCost)],
                  ['Labour', fmt.inr(v.labourCost)],
                  ['Mobilisation (once for this visit)', fmt.inr(v.mobilisationCost)],
                  [<span className="font-semibold text-ink">Estimated total</span>, <span className="font-semibold">{fmt.inr(v.totalEstimatedCost)}</span>],
                ]}
              />
              <div className="space-y-3">
                <Field label="Status">
                  {(p) => (
                    <Select {...p} value={v.status} onChange={(e) => update.mutate({ status: e.target.value })} disabled={update.isPending}>
                      <option value="planned">Planned</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed (marks potholes repaired)</option>
                      <option value="cancelled">Cancelled (releases potholes)</option>
                    </Select>
                  )}
                </Field>
                <div className="flex items-end gap-2">
                  <Field label="Actual cost (₹)" className="flex-1">
                    {(p) => <Input {...p} type="number" min="0" value={actual ?? v.actualCost?.toString() ?? ''} onChange={(e) => setActual(e.target.value)} />}
                  </Field>
                  <Button variant="secondary" disabled={actual === null} onClick={() => update.mutate({ actualCost: actual === '' ? null : Number(actual) })}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
            {v.unmeasuredCount > 0 && <Notice tone="warn">{v.unmeasuredCount} pothole(s) in this visit have no volume, so their material and labour are not included in the estimate.</Notice>}
            {!open && <Notice tone="neutral">This work order is {v.status}; its estimate is frozen and its potholes can no longer be changed.</Notice>}
            <Table>
              <THead>
                <tr>
                  <Th>Pothole</Th>
                  <Th>Location</Th>
                  <Th>Severity</Th>
                  <Th>Volume</Th>
                  <Th className="text-right">Material + labour</Th>
                  {open && <Th />}
                </tr>
              </THead>
              <TBody>
                {v.potholes.map((p) => (
                  <Tr key={p._id}>
                    <Td>
                      <Link to={`/app/potholes/${p._id}`} className="font-medium text-ink hover:underline">
                        {p.code}
                      </Link>
                    </Td>
                    <Td className="text-xs">{[p.roadName, p.locality].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td>
                      <SeverityBadge severity={p.severity} />
                    </Td>
                    <Td className="num">{p.volumeM3 != null ? fmt.m3(p.volumeM3) : <MeasurementBadge status={p.measurementStatus} />}</Td>
                    <Td className="num text-right">{fmt.inr((p.materialCost ?? 0) + (p.labourCost ?? 0) || null)}</Td>
                    {open && (
                      <Td className="text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.code}`} onClick={() => update.mutate({ removePotholeIds: [p._id] })}>
                          <Trash2 />
                        </Button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )
      )}
    </Dialog>
  );
}

export default function RepairsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const budget = useQuery({ queryKey: ['analytics', 'budget', {}], queryFn: async () => (await api.get('/analytics/budget')).data });
  const visits = useQuery({
    queryKey: ['repair-visits', { status, page }],
    queryFn: async () => (await api.get<Paged<RepairVisit>>('/repair-visits', { params: { status: status || undefined, page, limit: 15 } })).data,
  });
  const unscheduled = useQuery({
    queryKey: ['potholes', 'unscheduled-count'],
    queryFn: async () => (await api.get<Paged<Pothole>>('/potholes', { params: { repairStatus: 'reported', limit: 1, measurementStatus: 'complete' } })).data.total,
  });
  const b = budget.data;

  return (
    <>
      <PageHeader
        title="Budget & work orders"
        description="Group potholes into crew visits. Each visit pays mobilisation once, so planning visits by road lowers the estimate."
        actions={
          <Button asChild>
            <Link to="/app/priority">
              <Plus /> Plan from priority list
            </Link>
          </Button>
        }
      />
      {budget.isLoading ? (
        <Card><LoadingBlock rows={3} /></Card>
      ) : budget.isError ? (
        <Card><ErrorState message={errorMessage(budget.error)} onRetry={() => budget.refetch()} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total estimated budget" value={fmt.inr(b.total.estimatedBudget)} icon={<Wallet />} hint={`${b.total.measuredPotholes} measured potholes · ${b.total.visitGroups} visit(s)`} />
          <Stat label="Unrepaired estimate" value={fmt.inr(b.unrepaired.estimatedBudget)} icon={<IndianRupee />} tone="accent" />
          <Stat label="Mobilisation in estimate" value={fmt.inr(b.total.mobilisationCost)} icon={<ClipboardList />} hint="Provisional one visit per road for unscheduled potholes" />
          <Stat label="Actual cost recorded" value={fmt.inr(b.actual.actual)} icon={<IndianRupee />} tone="ok" hint={b.actual.itemsWithActual ? `${b.actual.itemsWithActual} item(s) with actuals` : 'Estimate only so far'} />
        </div>
      )}
      {(unscheduled.data ?? 0) > 0 && (
        <Notice tone="info" className="mt-6">
          {unscheduled.data} measured pothole(s) are reported but not yet in a work order.{' '}
          <Link className="font-medium underline" to="/app/priority">
            Select them from the priority list
          </Link>{' '}
          to create a visit.
        </Notice>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Work orders"
            actions={
              <div className="flex items-center gap-2">
                <Label htmlFor="vs" className="text-muted">
                  Status
                </Label>
                <Select
                  id="vs"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                  className="w-36"
                >
                  <option value="">All</option>
                  <option value="planned">Planned</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </div>
            }
          />
          {visits.isLoading ? (
            <LoadingBlock />
          ) : visits.isError ? (
            <ErrorState message={errorMessage(visits.error)} onRetry={() => visits.refetch()} />
          ) : !visits.data?.items.length ? (
            <EmptyState icon={<ClipboardList />} title="No work orders yet" description="Select potholes on the priority list and choose “Create work order”." />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Work order</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Potholes</Th>
                    <Th className="text-right">Estimate</Th>
                    <Th className="text-right">Actual</Th>
                    <Th>Scheduled</Th>
                  </tr>
                </THead>
                <TBody>
                  {visits.data.items.map((v) => (
                    <Tr key={v._id} className="cursor-pointer" onClick={() => setOpenId(v._id)}>
                      <Td>
                        <button className="text-left font-medium text-ink hover:underline" onClick={() => setOpenId(v._id)}>
                          {v.code}
                        </button>
                        <div className="text-xs text-muted">{v.title}</div>
                      </Td>
                      <Td>
                        <Badge tone={VISIT_TONE[v.status]}>{label('repair', v.status) === v.status ? v.status.replace('_', ' ') : label('repair', v.status)}</Badge>
                      </Td>
                      <Td className="num text-right">{v.potholes.length}</Td>
                      <Td className="num text-right">{fmt.inr(v.totalEstimatedCost)}</Td>
                      <Td className="num text-right">{fmt.inr(v.actualCost)}</Td>
                      <Td>{fmt.date(v.scheduledDate)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pagination page={visits.data.page} pages={visits.data.pages} total={visits.data.total} onPage={setPage} />
            </>
          )}
        </Card>
        <Card>
          <CardHeader title="Estimated budget by road" description="Includes provisional mobilisation" />
          <CardBody>
            {b?.byRoad?.length ? (
              <DefinitionList items={b.byRoad.slice(0, 12).map((r: any) => [`${r.name} (${r.count})`, fmt.inr(r.estimatedBudget)])} />
            ) : (
              <p className="text-[13px] text-muted">No measured potholes yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
      {openId && <VisitDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
