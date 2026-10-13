import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Briefcase, CheckCircle2, ClipboardCheck, Cpu, IndianRupee, Layers, MapPin, Ruler, Upload as UploadIcon, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { Overview, Paged, Pothole, Upload } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, Stat } from '@/components/ui/display';
import { JobStatusBadge, ProgressBar, SeverityBadge } from '@/components/domain';
import { SeverityDonut, TrendChart } from '@/features/analytics/charts';

function useOverview() {
  return useQuery({ queryKey: ['analytics', 'overview', {}], queryFn: async () => (await api.get<Overview>('/analytics/overview')).data });
}

function RecentUploads({ mine }: { mine?: boolean }) {
  const q = useQuery({
    queryKey: ['uploads', { limit: 6, mine }],
    queryFn: async () => (await api.get<Paged<Upload>>('/uploads', { params: { limit: 6, mine: mine ? 'true' : undefined } })).data,
    refetchInterval: (query) => (query.state.data?.items.some((u) => u.status === 'queued' || u.status === 'processing') ? 3000 : false),
  });
  return (
    <Card>
      <CardHeader title={mine ? 'My recent uploads' : 'Recent uploads'} actions={<Button variant="ghost" size="sm" asChild><Link to="/app/uploads">View all <ArrowRight /></Link></Button>} />
      {q.isLoading ? (
        <LoadingBlock rows={3} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<UploadIcon />} title="No uploads yet" description="Upload road photographs or a survey video to start detection." action={<Button asChild><Link to="/app/upload">New upload</Link></Button>} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.items.map((u) => (
            <li key={u._id}>
              <Link to={`/app/uploads/${u._id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-[#faf9f6]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-ink">{u.originalName}</div>
                  <div className="text-xs text-muted">
                    {u.kind === 'video' ? 'Video' : 'Image'} · {u.roadName ?? 'Road not set'} · {fmt.relative(u.createdAt)}
                  </div>
                  {(u.status === 'processing' || u.status === 'queued') && u.job && <ProgressBar value={u.job.progress} className="mt-2 max-w-xs" />}
                </div>
                <div className="text-right">
                  <JobStatusBadge status={u.status} />
                  {u.status === 'completed' && <div className="num mt-1 text-xs text-muted">{u.uniquePotholeCount} pothole(s)</div>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TopPriority() {
  const q = useQuery({ queryKey: ['potholes', 'top-priority'], queryFn: async () => (await api.get<Paged<Pothole>>('/potholes', { params: { limit: 6, sort: 'priority', repairStatus: 'reported,scheduled,in_progress,deferred' } })).data });
  return (
    <Card>
      <CardHeader title="Highest repair priority" description="Score explained on each record" actions={<Button variant="ghost" size="sm" asChild><Link to="/app/priority">Full list <ArrowRight /></Link></Button>} />
      {q.isLoading ? (
        <LoadingBlock rows={3} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState title="No open potholes" description="Open potholes will be ranked here." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.items.map((p) => (
            <li key={p._id}>
              <Link to={`/app/potholes/${p._id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#faf9f6]">
                <span className="num grid size-9 shrink-0 place-items-center rounded-md bg-graphite-900 text-[13px] font-semibold text-white">{Math.round(p.priorityScore)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-ink">
                    {p.code} <span className="font-normal text-muted">· {p.roadName ?? 'Road not set'}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{p.priorityReasons?.slice(0, 2).join(' · ')}</div>
                </div>
                <SeverityBadge severity={p.severity} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InspectorDashboard({ ov }: { ov: Overview }) {
  const c = ov.counts;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Potholes from my uploads" value={fmt.int(c.unique)} icon={<Layers />} hint={`${fmt.int(c.frameDetections)} frame-level detections`} />
        <Stat label="Not yet submitted" value={fmt.int(c.unsubmitted)} icon={<ClipboardCheck />} tone="accent" hint="Submit completed uploads for engineer review" />
        <Stat label="Not calibrated" value={fmt.int(c.unique - c.calibrated)} icon={<Ruler />} hint="Add a reference measurement to size these" />
        <Stat label="Verified by engineers" value={fmt.int(c.verified)} icon={<CheckCircle2 />} tone="ok" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <RecentUploads mine />
        <Card>
          <CardHeader title="Field checklist" />
          <CardBody className="space-y-3 text-[13.5px] text-ink-2">
            {[
              'Photograph in daylight with the camera pointed at the road surface.',
              'Place an A4 sheet or 30 cm ruler beside the pothole if you want measurements.',
              'Enable location on your phone camera so GPS is read from the photo, or type coordinates.',
              'Measure depth with a ruler where possible — monocular depth is relative only.',
              'Review results, calibrate, then submit the upload for engineer review.',
            ].map((t, i) => (
              <div key={t} className="flex gap-3">
                <span className="num grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-strong">{i + 1}</span>
                {t}
              </div>
            ))}
            <Button className="mt-2 w-full" asChild>
              <Link to="/app/upload">
                <UploadIcon /> Start a new upload
              </Link>
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function StaffDashboard({ ov, admin }: { ov: Overview; admin: boolean }) {
  const c = ov.counts;
  const severity = (['minor', 'moderate', 'severe', 'unclassified'] as const).map((s) => ({ severity: s, count: c[s] }));
  const sev = useQuery({ queryKey: ['analytics', 'severity', {}], queryFn: async () => (await api.get('/analytics/severity')).data });
  const trend = useQuery({ queryKey: ['analytics', 'trends', 'month'], queryFn: async () => (await api.get('/analytics/trends', { params: { interval: 'month' } })).data.items });
  const pendingUsers = useQuery({ queryKey: ['users', 'pending'], enabled: admin, queryFn: async () => (await api.get('/users', { params: { status: 'pending', limit: 5 } })).data });
  const failedJobs = useQuery({ queryKey: ['jobs', 'failed-count'], enabled: admin, queryFn: async () => (await api.get('/jobs', { params: { status: 'failed', limit: 1 } })).data });
  return (
    <>
      {admin && ((pendingUsers.data?.total ?? 0) > 0 || (failedJobs.data?.total ?? 0) > 0) && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {(pendingUsers.data?.total ?? 0) > 0 && (
            <Notice tone="warn" icon={<Users />} title={`${pendingUsers.data.total} registration(s) awaiting approval`}>
              <Link to="/app/users?status=pending" className="font-medium underline">
                Review registrations
              </Link>
            </Notice>
          )}
          {(failedJobs.data?.total ?? 0) > 0 && (
            <Notice tone="danger" icon={<Briefcase />} title={`${failedJobs.data.total} failed processing job(s)`}>
              <Link to="/app/jobs?status=failed" className="font-medium underline">
                Inspect and retry
              </Link>
            </Notice>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Unique potholes" value={fmt.int(c.unique)} icon={<Layers />} hint={`${fmt.int(c.frameDetections)} frame-level detections · ${ov.areasWithPotholes} area(s)`} />
        <Stat label="Pending review" value={fmt.int(c.pendingReview)} icon={<ClipboardCheck />} tone="accent" hint={`${fmt.int(c.needsReview)} flagged for attention`} />
        <Stat label="Severe awaiting repair" value={sev.data ? fmt.int(sev.data.severeAwaitingRepair) : '…'} icon={<AlertTriangle />} tone="danger" hint={`Severe estimate ${fmt.inr(ov.severeBudget.estimatedBudget)}`} />
        <Stat label="Unrepaired estimated budget" value={fmt.inrCompact(ov.unrepairedBudget.estimatedBudget)} icon={<IndianRupee />} hint={`${ov.budget.measuredPotholes} of ${c.unique} potholes measured · estimate, not expenditure`} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Severity distribution" description="Unique potholes in scope" />
          <CardBody>
            <SeverityDonut data={severity} />
            {c.unclassified > 0 && <p className="mt-3 text-xs text-muted">“Not classified” records lack calibration or depth, so their volume is unknown.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Detected, verified and repaired" description="Monthly unique potholes" actions={<Button variant="ghost" size="sm" asChild><Link to="/app/analytics">Analytics <ArrowRight /></Link></Button>} />
          <CardBody>{trend.isLoading ? <LoadingBlock rows={3} /> : trend.isError ? <ErrorState message={errorMessage(trend.error)} /> : <TrendChart data={trend.data ?? []} />}</CardBody>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <TopPriority />
        <RecentUploads />
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const ov = useOverview();
  const role = user!.role;
  return (
    <>
      <PageHeader
        eyebrow={role === 'admin' ? 'Administrator' : role === 'engineer' ? 'Road Engineer' : 'Field Inspector'}
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user!.name.split(' ')[0]}`}
        description={role === 'inspector' ? 'Your uploads, detections and what still needs calibration or submission.' : 'Live figures from the pothole register. Estimates are shown separately from actual expenditure.'}
        actions={
          <>
            {role !== 'inspector' && (
              <Button variant="secondary" asChild>
                <Link to="/app/map">
                  <MapPin /> Map
                </Link>
              </Button>
            )}
            {role === 'admin' && (
              <Button variant="secondary" asChild>
                <Link to="/app/model">
                  <Cpu /> Model status
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link to="/app/upload">
                <UploadIcon /> New upload
              </Link>
            </Button>
          </>
        }
      />
      {ov.isLoading ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : ov.isError ? (
        <Card>
          <ErrorState message={errorMessage(ov.error)} onRetry={() => ov.refetch()} />
        </Card>
      ) : role === 'inspector' ? (
        <InspectorDashboard ov={ov.data!} />
      ) : (
        <StaffDashboard ov={ov.data!} admin={role === 'admin'} />
      )}
    </>
  );
}

