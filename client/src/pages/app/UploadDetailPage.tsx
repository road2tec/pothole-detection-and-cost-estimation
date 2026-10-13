import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Cpu, Info, Ruler, RotateCcw, Send, Timer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { Job, Pothole, Upload } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DefinitionList, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { AuthedImage, ConfidenceMeter, JobStatusBadge, MeasurementBadge, ProgressBar, SeverityBadge, VerificationBadge } from '@/components/domain';

interface Detail {
  upload: Upload & { calibration?: string; storagePath: string };
  job: Job | null;
  potholes: Pothole[];
}

export default function UploadDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<'annotated' | 'original'>('annotated');
  const q = useQuery({
    queryKey: ['upload', id],
    queryFn: async () => (await api.get<Detail>(`/uploads/${id}`)).data,
    refetchInterval: (query) => (['queued', 'processing'].includes(query.state.data?.upload.status ?? '') ? 2000 : false),
  });
  const submit = useMutation({
    mutationFn: () => api.post(`/uploads/${id}/submit`),
    onSuccess: (r) => {
      toast.success(`${r.data.submitted} pothole(s) submitted for engineer review`);
      qc.invalidateQueries({ queryKey: ['upload', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retry = useMutation({
    mutationFn: () => api.post(`/uploads/${id}/retry`),
    onSuccess: () => {
      toast.success('Queued again');
      qc.invalidateQueries({ queryKey: ['upload', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const { upload, job, potholes } = q.data!;
  const processing = upload.status === 'queued' || upload.status === 'processing';
  const unsubmitted = potholes.filter((p) => p.verificationStatus === 'unsubmitted').length;
  const calibrated = Boolean(upload.calibration) || Boolean(upload.cameraProfile);
  const isVideo = upload.kind === 'video';

  return (
    <>
      <Link to="/app/uploads" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Uploads
      </Link>
      <PageHeader
        title={upload.originalName}
        description={[upload.roadName, upload.locality, upload.ward && `Ward ${upload.ward}`].filter(Boolean).join(' · ') || 'No road or locality recorded'}
        actions={
          <>
            {upload.status === 'failed' && (
              <Button variant="secondary" onClick={() => retry.mutate()} loading={retry.isPending}>
                <RotateCcw /> Retry processing
              </Button>
            )}
            {upload.status === 'completed' && !isVideo && potholes.length > 0 && (
              <Button variant="secondary" asChild>
                <Link to={`/app/uploads/${id}/calibrate`}>
                  <Ruler /> {upload.calibration ? 'Recalibrate' : 'Calibrate'}
                </Link>
              </Button>
            )}
            {upload.status === 'completed' && unsubmitted > 0 && (
              <Button onClick={() => submit.mutate()} loading={submit.isPending}>
                <Send /> Submit {unsubmitted} for review
              </Button>
            )}
          </>
        }
      />

      {processing && (
        <Card className="mb-6">
          <CardBody>
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="font-medium text-ink">{job?.stage ?? 'Waiting for a worker'}</span>
              <span className="num text-muted">{Math.round(job?.progress ?? 0)}%</span>
            </div>
            <ProgressBar value={job?.progress ?? 2} />
            {job?.error && <p className="mt-2 text-xs text-warn">Last attempt: {job.error}. Retrying automatically ({job.attempts}/{job.maxAttempts}).</p>}
          </CardBody>
        </Card>
      )}
      {upload.status === 'failed' && (
        <Notice tone="danger" icon={<AlertTriangle />} title="Processing failed" className="mb-6">
          {upload.error ?? 'The AI service could not process this file.'} No detections were stored. Retry once the cause is fixed.
        </Notice>
      )}

      {upload.status === 'completed' && (
        <>
          {!isVideo && potholes.length > 0 && !calibrated && (
            <Notice tone="warn" icon={<Ruler />} title="Not calibrated" className="mb-6">
              Detections are shown, but length, width, volume and cost stay unavailable until you mark a reference object of known size in this image.
            </Notice>
          )}
          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader
                title={isVideo ? 'Best frame of the first track' : 'Detection result'}
                actions={
                  !isVideo && (
                    <Tabs value={view} onValueChange={(v) => setView(v as 'annotated' | 'original')}>
                      <TabsList>
                        <TabsTrigger value="annotated">Annotated</TabsTrigger>
                        <TabsTrigger value="original">Original</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  )
                }
              />
              <div className="bg-graphite-950">
                <AuthedImage
                  key={view}
                  src={view === 'annotated' || isVideo ? (upload.annotatedPath ? `/uploads/${id}/annotated` : null) : `/uploads/${id}/original`}
                  alt={view === 'annotated' ? `Annotated detections on ${upload.originalName}` : `Original photograph ${upload.originalName}`}
                  className="mx-auto max-h-[560px] w-auto object-contain"
                  fallbackClassName="h-72"
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Analysis" />
              <CardBody>
                <DefinitionList
                  items={[
                    ['Status', <JobStatusBadge status={upload.status} />],
                    [isVideo ? 'Frame-level detections' : 'Detections', fmt.int(upload.detectionCount)],
                    ['Unique potholes', fmt.int(upload.uniquePotholeCount)],
                    [
                      <span className="flex items-center gap-1.5">
                        <Timer className="size-3.5" /> {isVideo ? 'Total inference' : 'Inference time'}
                      </span>,
                      upload.inferenceMs ? `${Math.round(upload.inferenceMs)} ms` : '—',
                    ],
                    [
                      <span className="flex items-center gap-1.5">
                        <Cpu className="size-3.5" /> Model
                      </span>,
                      <span className="break-all font-mono text-xs">{upload.modelVersion ?? '—'}</span>,
                    ],
                    ['Calibration', upload.calibration ? 'Reference object' : typeof upload.cameraProfile === 'object' ? `Profile: ${upload.cameraProfile.name}` : 'None'],
                    ['GPS', upload.gps ? `${upload.gps.lat.toFixed(5)}, ${upload.gps.lon.toFixed(5)} (${upload.gps.source})` : isVideo ? 'From GPX only' : 'Not recorded'],
                    ['Image size', upload.width ? `${upload.width} × ${upload.height} px` : '—'],
                    ['Uploaded', fmt.dateTime(upload.createdAt)],
                    ['By', typeof upload.uploadedBy === 'object' ? upload.uploadedBy.name : '—'],
                  ]}
                />
                {upload.submittedForReviewAt && <p className="mt-3 text-xs text-muted">Submitted for review {fmt.relative(upload.submittedForReviewAt)}.</p>}
                <p className="mt-3 flex gap-1.5 text-xs text-muted">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  Confidence is the model's score for each box — not measurement accuracy.
                </p>
              </CardBody>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader title={`Potholes (${potholes.length})`} description={isVideo ? 'One record per tracked pothole; best frame shown.' : 'One record per detection above the confidence threshold.'} />
            {potholes.length === 0 ? (
              <EmptyState title="No potholes detected" description="The model found no pothole above the confidence threshold in this file. This is a genuine empty result." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Pothole</Th>
                    <Th>Confidence</Th>
                    {isVideo && <Th>Frames</Th>}
                    <Th>Size (L × W × D)</Th>
                    <Th>Measurement</Th>
                    <Th>Severity</Th>
                    <Th className="text-right">Est. cost (single visit)</Th>
                    <Th>Review</Th>
                  </tr>
                </THead>
                <TBody>
                  {potholes.map((p) => (
                    <Tr key={p._id}>
                      <Td>
                        <Link to={`/app/potholes/${p._id}`} className="flex items-center gap-3">
                          <AuthedImage src={`/potholes/${p._id}/crop`} alt={`Crop of ${p.code}`} className="size-12 rounded object-cover" fallbackClassName="size-12 rounded" />
                          <span className="font-medium text-ink hover:underline">{p.code}</span>
                        </Link>
                      </Td>
                      <Td>
                        <ConfidenceMeter value={p.confidence} />
                        {p.needsReview && <div className="mt-1 text-xs text-warn">Needs review</div>}
                      </Td>
                      {isVideo && <Td className="num">{p.observationCount}</Td>}
                      <Td className="num whitespace-nowrap">
                        {p.lengthM != null ? `${p.lengthM.toFixed(2)} × ${p.widthM?.toFixed(2)} × ${p.depthM != null ? p.depthM.toFixed(3) : '?'} m` : '—'}
                        {p.dimensionSource && <div className="text-xs text-muted">{label('dimensionSource', p.dimensionSource)}</div>}
                      </Td>
                      <Td>
                        <MeasurementBadge status={p.measurementStatus} />
                      </Td>
                      <Td>
                        <SeverityBadge severity={p.severity} />
                      </Td>
                      <Td className="num text-right">{fmt.inr(p.singleVisitTotal)}</Td>
                      <Td>
                        <VerificationBadge status={p.verificationStatus} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          {user!.role === 'inspector' && unsubmitted === 0 && potholes.length > 0 && <p className="mt-3 text-xs text-muted">All potholes from this upload have been submitted.</p>}
        </>
      )}
    </>
  );
}
