import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, ListOrdered, MapPin, Wrench } from 'lucide-react';
import { api, downloadFile, errorMessage, toParams } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { Paged, Pothole } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { FilterBar, useFilters, type Filters } from '@/features/potholes/filters';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '@/components/ui/display';
import { Dialog } from '@/components/ui/overlay';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { ConfidenceMeter, DemoBadge, MeasurementBadge, RepairBadge, SeverityBadge, VerificationBadge } from '@/components/domain';

type Mode = 'manage' | 'review' | 'priority';

const MODE_CONFIG: Record<Mode, { title: string; description: string; defaults: Filters; sort: string }> = {
  manage: { title: 'Potholes', description: 'Every unique pothole in your scope with its measurements, estimate and status.', defaults: {}, sort: 'newest' },
  review: { title: 'Review queue', description: 'Detections submitted by inspectors, flagged low-confidence detections first. Verify, reject or correct each record.', defaults: { verificationStatus: 'pending_review' }, sort: 'confidence' },
  priority: { title: 'Repair priority', description: 'Open potholes ranked by a configurable, explained score. Severity is shown separately and is not the same as priority.', defaults: { repairStatus: 'reported,scheduled,in_progress,deferred' }, sort: 'priority' },
};

function CreateVisitDialog({ ids, open, onOpenChange, onDone }: { ids: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => api.post('/repair-visits', { title, potholeIds: ids, scheduledDate: date || undefined, notes: notes || undefined }),
    onSuccess: (r) => {
      toast.success(`Work order ${r.data.visit.code} created — estimated ${fmt.inr(r.data.visit.totalEstimatedCost)}`);
      onDone();
      navigate('/app/repairs');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create repair work order"
      description={`${ids.length} pothole(s) repaired in one crew visit. Mobilisation is charged once for the visit.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={title.trim().length < 3} loading={m.isPending}>
            Create work order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ward 4 patching — week 42" />}
        </Field>
        <Field label="Scheduled date">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Notes">{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

export default function PotholesPage({ mode = 'manage' }: { mode?: Mode }) {
  const cfg = MODE_CONFIG[mode];
  const { user } = useAuth();
  const staff = user!.role !== 'inspector';
  const qc = useQueryClient();
  const { filters, page, set, reset } = useFilters(cfg.defaults);
  const [sort, setSort] = useState(cfg.sort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visitOpen, setVisitOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const q = useQuery({
    queryKey: ['potholes', { ...filters, page, sort }],
    queryFn: async () => (await api.get<Paged<Pothole>>('/potholes', { params: { ...toParams(filters), page, limit: 25, sort } })).data,
  });
  const items = q.data?.items ?? [];
  const toggle = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectable = (p: Pothole) => p.verificationStatus !== 'rejected' && p.repairStatus !== 'repaired' && !p.repairVisit;
  const allSelected = items.filter(selectable).length > 0 && items.filter(selectable).every((p) => selected.has(p._id));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const filtersBody = toParams(filters);
      const r = await api.post('/reports/csv', { type: 'potholes', title: `${cfg.title} export`, filters: filtersBody });
      await downloadFile(`/reports/${r.data.report._id}/download`, 'potholes.csv');
      toast.success(`${r.data.rows} row(s) exported`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to={`/app/map?${new URLSearchParams(toParams(filters)).toString()}`}>
                <MapPin /> View on map
              </Link>
            </Button>
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              <Download /> Export CSV
            </Button>
          </>
        }
      />
      <Card>
        <div className="space-y-3 border-b border-line px-5 py-4">
          <FilterBar filters={filters} set={set} reset={reset} allowDemo={staff} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="sort" className="text-muted">
                Sort
              </Label>
              <Select id="sort" value={sort} onChange={(e) => setSort(e.target.value)} className="w-48">
                <option value="priority">Priority score</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="confidence">Highest confidence</option>
                <option value="volume">Largest volume</option>
                <option value="cost">Highest cost</option>
              </Select>
            </div>
            {staff && selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">{selected.size} selected</span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button size="sm" onClick={() => setVisitOpen(true)}>
                  <Wrench /> Create work order
                </Button>
              </div>
            )}
          </div>
        </div>
        {q.isLoading ? (
          <LoadingBlock rows={8} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState icon={<ListOrdered />} title={mode === 'review' ? 'Nothing waiting for review' : 'No potholes match these filters'} description={mode === 'review' ? 'Submitted detections will appear here.' : 'Try clearing filters, or upload survey material.'} />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    {staff && (
                      <Th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all on this page"
                          checked={allSelected}
                          onChange={() => setSelected(allSelected ? new Set() : new Set(items.filter(selectable).map((p) => p._id)))}
                          className="size-4 accent-[var(--color-accent)]"
                        />
                      </Th>
                    )}
                    {mode === 'priority' && <Th>Score</Th>}
                    <Th>Pothole</Th>
                    <Th>Location</Th>
                    <Th>Confidence</Th>
                    <Th>Volume</Th>
                    <Th>Severity</Th>
                    <Th className="text-right">Material + labour</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <TBody>
                  {items.map((p) => (
                    <Tr key={p._id}>
                      {staff && (
                        <Td>
                          <input type="checkbox" aria-label={`Select ${p.code}`} disabled={!selectable(p)} checked={selected.has(p._id)} onChange={() => toggle(p._id)} className="size-4 accent-[var(--color-accent)]" />
                        </Td>
                      )}
                      {mode === 'priority' && (
                        <Td>
                          <span className="num grid size-9 place-items-center rounded-md bg-graphite-900 text-[13px] font-semibold text-white" title={p.priorityReasons?.join('\n')}>
                            {Math.round(p.priorityScore)}
                          </span>
                        </Td>
                      )}
                      <Td>
                        <Link to={`/app/potholes/${p._id}`} className="font-medium text-ink hover:underline">
                          {p.code}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {p.isDemo && <DemoBadge />}
                          {p.needsReview && <span className="text-xs text-warn">Needs review</span>}
                        </div>
                        {mode === 'priority' && <div className="mt-1 max-w-[260px] text-xs text-muted">{p.priorityReasons?.slice(0, 3).join(' · ')}</div>}
                      </Td>
                      <Td>
                        <div className="text-ink">{p.roadName ?? '—'}</div>
                        <div className="text-xs text-muted">
                          {[p.locality, p.ward].filter(Boolean).join(' · ') || '—'}
                          {p.location ? ' · GPS' : ''}
                        </div>
                      </Td>
                      <Td>
                        <ConfidenceMeter value={p.confidence} />
                      </Td>
                      <Td className="num">{p.volumeM3 != null ? fmt.m3(p.volumeM3) : <MeasurementBadge status={p.measurementStatus} />}</Td>
                      <Td>
                        <SeverityBadge severity={p.severity} />
                      </Td>
                      <Td className="num text-right">{fmt.inr(p.variableCost)}</Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <VerificationBadge status={p.verificationStatus} />
                          <RepairBadge status={p.repairStatus} />
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((p) => (
                <li key={p._id} className="flex gap-3 px-4 py-3">
                  {staff && <input type="checkbox" aria-label={`Select ${p.code}`} disabled={!selectable(p)} checked={selected.has(p._id)} onChange={() => toggle(p._id)} className="mt-1 size-4 accent-[var(--color-accent)]" />}
                  <Link to={`/app/potholes/${p._id}`} className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{p.code}</span>
                      <SeverityBadge severity={p.severity} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">{[p.roadName, p.locality].filter(Boolean).join(' · ') || 'No location'}</div>
                    <div className="num mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                      <span>conf {fmt.conf(p.confidence)}</span>
                      <span>· {p.volumeM3 != null ? fmt.m3(p.volumeM3) : 'unmeasured'}</span>
                      <span>· {fmt.inr(p.variableCost)}</span>
                      {mode === 'priority' && <span>· score {Math.round(p.priorityScore)}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <VerificationBadge status={p.verificationStatus} />
                      <RepairBadge status={p.repairStatus} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pages={q.data!.pages} total={q.data!.total} onPage={(pg) => set({ page: pg } as Filters & { page: number })} />
          </>
        )}
      </Card>
      <CreateVisitDialog
        ids={[...selected]}
        open={visitOpen}
        onOpenChange={setVisitOpen}
        onDone={() => {
          setSelected(new Set());
          setVisitOpen(false);
          qc.invalidateQueries({ queryKey: ['potholes'] });
        }}
      />
    </>
  );
}
