import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, IndianRupee, Layers, MapPinned, Ruler, Target, Wrench } from 'lucide-react';
import { api, downloadFile, errorMessage, toParams } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { BudgetTotals, Overview } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { FilterBar, useFilters } from '@/features/potholes/filters';
import { MoneyBar, SERIES, SEV_COLORS, SeverityDonut, SimpleBar, StackedSeverityBar, TrendChart } from '@/features/analytics/charts';
import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/form';
import { Card, CardBody, CardHeader, ErrorState, LoadingBlock, Notice, PageHeader, Pagination, Stat } from '@/components/ui/display';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

function useA<T>(path: string, params: Record<string, unknown>) {
  return useQuery({ queryKey: ['analytics', path, params], queryFn: async () => (await api.get<T>(`/analytics/${path}`, { params: toParams(params) })).data });
}

function Block({ q, children }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }; children: () => React.ReactNode }) {
  if (q.isLoading) return <LoadingBlock rows={4} />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={q.refetch} />;
  return <>{children()}</>;
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const staff = user!.role !== 'inspector';
  const { filters, set, reset } = useFilters();
  const [interval, setInterval] = useState<'day' | 'week' | 'month'>('month');
  const [level, setLevel] = useState<'road' | 'ward' | 'locality'>('locality');
  const [areaPage, setAreaPage] = useState(1);

  const ov = useA<Overview>('overview', filters);
  const sev = useA<any>('severity', filters);
  const trends = useA<{ items: any[] }>('trends', { ...filters, interval });
  const areas = useA<any>('areas', { ...filters, level, page: areaPage, limit: 15 });
  const budget = useA<any>('budget', filters);
  const quality = useA<any>('quality', filters);

  const exportCsv = async (type: 'areas' | 'severity' | 'budget' | 'potholes') => {
    try {
      const r = await api.post('/reports/csv', { type, filters: toParams(filters) });
      await downloadFile(`/reports/${r.data.report._id}/download`, `${type}.csv`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const o = ov.data;
  const b: BudgetTotals | undefined = o?.budget;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Live aggregates from the pothole register. Unique potholes are counted once; frame-level detections are shown separately. Costs are estimates unless labelled actual."
        actions={
          <>
            <Button variant="secondary" onClick={() => exportCsv('areas')}>
              <Download /> Area CSV
            </Button>
            <Button variant="secondary" onClick={() => exportCsv('budget')}>
              <Download /> Budget CSV
            </Button>
          </>
        }
      />
      <Card className="mb-6 px-5 py-4">
        <FilterBar filters={filters} set={set} reset={reset} allowDemo={staff} />
      </Card>
      {filters.dataset && filters.dataset !== 'live' && (
        <Notice tone="neutral" className="mb-6" title="Demo records included">
          Figures include synthetic demo records that were not produced by the AI model.
        </Notice>
      )}

      <Block q={ov}>
        {() => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Unique potholes" value={fmt.int(o!.counts.unique)} icon={<Layers />} hint={`${fmt.int(o!.counts.frameDetections)} total frame-level detections`} />
              <Stat label="Verified" value={fmt.int(o!.counts.verified)} icon={<CheckCircle2 />} tone="ok" hint={`Verification rate ${fmt.pct(o!.verificationRate)}`} />
              <Stat label="Pending review" value={fmt.int(o!.counts.pendingReview)} icon={<ClipboardCheck />} tone="accent" hint={`${fmt.int(o!.counts.unsubmitted)} not yet submitted`} />
              <Stat label="Repaired" value={fmt.int(o!.counts.repaired)} icon={<Wrench />} tone="ok" hint={`Completion rate ${fmt.pct(o!.repairCompletionRate)}`} />
              <Stat label="Minor · Moderate · Severe" value={`${o!.counts.minor} · ${o!.counts.moderate} · ${o!.counts.severe}`} icon={<AlertTriangle />} tone="danger" hint={`${o!.counts.unclassified} not classified (unmeasured)`} />
              <Stat label="Total estimated budget" value={fmt.inr(b!.estimatedBudget)} icon={<IndianRupee />} hint={`${b!.measuredPotholes} measured potholes · ${b!.visitGroups} repair visit(s)`} />
              <Stat label="Estimated cost of severe potholes" value={fmt.inr(o!.severeBudget.estimatedBudget)} icon={<AlertTriangle />} tone="danger" hint="Includes mobilisation for their visits" />
              <Stat
                label="Budget variance"
                value={o!.budgetVariance === null ? 'No target set' : fmt.inr(o!.budgetVariance)}
                icon={<Target />}
                hint={o!.budgetTarget === null ? 'An administrator can set a budget target' : `Target ${fmt.inr(o!.budgetTarget)} − estimate`}
              />
              <Stat label="Areas with potholes" value={fmt.int(o!.areasWithPotholes)} icon={<MapPinned />} hint={`${fmt.int(o!.counts.withLocation)} potholes with GPS`} />
              <Stat label="Measured" value={fmt.pct(o!.measurementRate)} icon={<Ruler />} hint={`${o!.counts.measured} of ${o!.counts.unique} have L, W and D`} />
              <Stat label="Avg. estimate per measured pothole" value={fmt.inr(o!.averageCostPerMeasuredPothole)} icon={<IndianRupee />} />
              <Stat label="Actual repair cost recorded" value={fmt.inr(o!.actual.actual)} icon={<Wrench />} hint={o!.actual.itemsWithActual ? `vs ${fmt.inr(o!.actual.estimatedForActual)} estimated for the same items` : 'No actual costs recorded yet'} />
            </div>
          </>
        )}
      </Block>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader title="Severity distribution" description="Unique potholes" />
          <CardBody>
            <Block q={sev}>{() => <SeverityDonut data={sev.data.severity} />}</Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Detected vs verified vs repaired"
            description="Unique potholes per period (detection, review and repair dates)"
            actions={
              <Select aria-label="Interval" value={interval} onChange={(e) => setInterval(e.target.value as typeof interval)} className="w-32">
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </Select>
            }
          />
          <CardBody>
            <Block q={trends}>{() => <TrendChart data={trends.data!.items} />}</Block>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Severity by locality" description={sev.data ? `${sev.data.severeAwaitingRepair} severe pothole(s) awaiting repair` : undefined} />
          <CardBody>
            <Block q={sev}>{() => <StackedSeverityBar data={sev.data.byLocality.slice(0, 10)} />}</Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Severity trend" description="Unique potholes by detection month" />
          <CardBody>
            <Block q={sev}>
              {() => (
                <MoneyBar
                  data={sev.data.trend.map((t: any) => ({ name: t.period, ...t }))}
                  keys={[
                    ['severe', 'Severe', SEV_COLORS.severe],
                    ['moderate', 'Moderate', SEV_COLORS.moderate],
                    ['minor', 'Minor', SEV_COLORS.minor],
                    ['unclassified', 'Not classified', SEV_COLORS.unclassified],
                  ]}
                />
              )}
            </Block>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Area-wise comparison"
          description="Counts, severity mix and estimated budget (mobilisation counted once per visit)"
          actions={
            <div className="flex items-center gap-2">
              <Label htmlFor="lvl" className="text-muted">
                Group by
              </Label>
              <Select
                id="lvl"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value as typeof level);
                  setAreaPage(1);
                }}
                className="w-36"
              >
                <option value="road">Road</option>
                <option value="ward">Ward</option>
                <option value="locality">Locality</option>
              </Select>
            </div>
          }
        />
        <Block q={areas}>
          {() => (
            <>
              <div className="border-b border-line px-5 py-4">
                <MoneyBar
                  height={240}
                  data={areas.data.items.slice(0, 12).map((a: any) => ({ name: a.name, materialCost: a.materialCost, labourCost: a.labourCost, mobilisationCost: a.mobilisationCost }))}
                  keys={[
                    ['materialCost', 'Material', SERIES[0]],
                    ['labourCost', 'Labour', SERIES[1]],
                    ['mobilisationCost', 'Mobilisation', SERIES[4]],
                  ]}
                />
              </div>
              <Table>
                <THead>
                  <tr>
                    <Th>{level[0].toUpperCase() + level.slice(1)}</Th>
                    <Th className="text-right">Potholes</Th>
                    <Th className="text-right">Severe</Th>
                    <Th className="text-right">Moderate</Th>
                    <Th className="text-right">Minor</Th>
                    <Th className="text-right">Unclassified</Th>
                    <Th className="text-right">Repaired</Th>
                    <Th className="text-right">Estimated budget</Th>
                    <Th className="text-right">Max priority</Th>
                  </tr>
                </THead>
                <TBody>
                  {areas.data.items.map((a: any) => (
                    <Tr key={a.name}>
                      <Td className="font-medium text-ink">
                        {a.name}
                        {level === 'road' && <div className="text-xs font-normal text-muted">{[a.locality, a.ward].filter(Boolean).join(' · ')}</div>}
                      </Td>
                      <Td className="num text-right">{a.count}</Td>
                      <Td className="num text-right">{a.severe}</Td>
                      <Td className="num text-right">{a.moderate}</Td>
                      <Td className="num text-right">{a.minor}</Td>
                      <Td className="num text-right">{a.unclassified}</Td>
                      <Td className="num text-right">{a.repaired}</Td>
                      <Td className="num text-right font-medium text-ink">{fmt.inr(a.estimatedBudget)}</Td>
                      <Td className="num text-right">{Math.round(a.maxPriority)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pagination page={areas.data.page} pages={areas.data.pages} total={areas.data.total} onPage={setAreaPage} />
            </>
          )}
        </Block>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Estimated budget breakdown" description="Material, labour and mobilisation (once per repair visit)" />
          <CardBody>
            <Block q={budget}>
              {() => {
                const t = budget.data.total;
                const u = budget.data.unrepaired;
                const rows = [
                  ['Material', t.materialCost, SERIES[0]],
                  ['Labour', t.labourCost, SERIES[1]],
                  ['Mobilisation', t.mobilisationCost, SERIES[4]],
                ] as const;
                const total = t.estimatedBudget || 1;
                return (
                  <div className="space-y-4">
                    <div className="flex h-3 overflow-hidden rounded-full bg-subtle" aria-hidden>
                      {rows.map(([n, v, c]) => (
                        <div key={n} style={{ width: `${(v / total) * 100}%`, background: c }} />
                      ))}
                    </div>
                    <dl className="grid gap-2 text-[13px] sm:grid-cols-3">
                      {rows.map(([n, v, c]) => (
                        <div key={n} className="rounded-lg border border-line px-3 py-2">
                          <dt className="flex items-center gap-1.5 text-muted">
                            <span className="size-2 rounded-sm" style={{ background: c }} />
                            {n}
                          </dt>
                          <dd className="num mt-0.5 font-semibold text-ink">{fmt.inr(v)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="num grid gap-2 text-[13px] sm:grid-cols-2">
                      <div className="rounded-lg bg-subtle px-3 py-2">
                        Total estimate <span className="float-right font-semibold">{fmt.inr(t.estimatedBudget)}</span>
                      </div>
                      <div className="rounded-lg bg-subtle px-3 py-2">
                        Unrepaired estimate <span className="float-right font-semibold">{fmt.inr(u.estimatedBudget)}</span>
                      </div>
                    </div>
                    <div className="text-xs text-muted">Variable cost by severity (excludes mobilisation, which belongs to visits, not severities):</div>
                    <dl className="grid gap-2 text-[13px] sm:grid-cols-3">
                      {budget.data.bySeverity
                        .filter((s: any) => s.severity !== 'unclassified')
                        .map((s: any) => (
                          <div key={s.severity} className="flex justify-between rounded-lg border border-line px-3 py-2">
                            <dt className="text-muted">{label('severity', s.severity)}</dt>
                            <dd className="num font-medium text-ink">{fmt.inr(s.variableCost)}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                );
              }}
            </Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Monthly estimated budget" description="By detection month" />
          <CardBody>
            <Block q={budget}>
              {() => (
                <MoneyBar
                  data={budget.data.monthly.map((m: any) => ({ name: m.period, materialCost: m.materialCost, labourCost: m.labourCost, mobilisationCost: m.mobilisationCost }))}
                  keys={[
                    ['materialCost', 'Material', SERIES[0]],
                    ['labourCost', 'Labour', SERIES[1]],
                    ['mobilisationCost', 'Mobilisation', SERIES[4]],
                  ]}
                />
              )}
            </Block>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Estimated budget by road" description="Top 20" />
          <CardBody>
            <Block q={budget}>{() => <MoneyBar data={budget.data.byRoad} keys={[['variableCost', 'Material + labour', SERIES[0]], ['mobilisationCost', 'Mobilisation', SERIES[4]]]} />}</Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Budget vs actual" description="Work orders with recorded actual cost" />
          <Block q={budget}>
            {() =>
              budget.data.visits.filter((v: any) => v.actualCost != null).length === 0 ? (
                <CardBody>
                  <p className="text-[13px] text-muted">No actual repair costs have been recorded yet. Enter them on completed work orders to compare against estimates.</p>
                </CardBody>
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>Work order</Th>
                      <Th className="text-right">Estimated</Th>
                      <Th className="text-right">Actual</Th>
                      <Th className="text-right">Difference</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {budget.data.visits
                      .filter((v: any) => v.actualCost != null)
                      .map((v: any) => (
                        <Tr key={v._id}>
                          <Td>
                            <div className="font-medium text-ink">{v.code}</div>
                            <div className="text-xs text-muted">{v.title}</div>
                          </Td>
                          <Td className="num text-right">{fmt.inr(v.totalEstimatedCost)}</Td>
                          <Td className="num text-right">{fmt.inr(v.actualCost)}</Td>
                          <Td className={`num text-right ${v.actualCost > v.totalEstimatedCost ? 'text-danger' : 'text-ok'}`}>{fmt.inr(v.actualCost - v.totalEstimatedCost)}</Td>
                        </Tr>
                      ))}
                  </TBody>
                </Table>
              )
            }
          </Block>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader title="Repair status funnel" />
          <CardBody>
            <Block q={quality}>{() => <SimpleBar data={quality.data.repairFunnel.map((f: any) => ({ ...f, name: label('repair', f.status) }))} dataKey="count" nameKey="name" color={SERIES[2]} />}</Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Review backlog" />
          <CardBody>
            <Block q={quality}>{() => <SimpleBar data={quality.data.review.map((f: any) => ({ ...f, name: label('verification', f.status) }))} dataKey="count" nameKey="name" color={SERIES[1]} />}</Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Detection confidence" description="Model score, not accuracy" />
          <CardBody>
            <Block q={quality}>{() => <SimpleBar data={quality.data.confidence} dataKey="count" nameKey="bin" />}</Block>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Measurement status" />
          <CardBody>
            <Block q={quality}>{() => <SimpleBar data={quality.data.measurement.map((f: any) => ({ ...f, name: label('measurement', f.status) }))} dataKey="count" nameKey="name" color={SERIES[3]} />}</Block>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
