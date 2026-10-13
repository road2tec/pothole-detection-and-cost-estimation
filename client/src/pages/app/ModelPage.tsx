import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cpu, Layers } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, DefinitionList, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

export default function ModelPage() {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: async () => (await api.get('/ai/status')).data, refetchInterval: 15_000 });
  const models = useQuery({ queryKey: ['ai-models'], queryFn: async () => (await api.get('/ai/models')).data });

  if (status.isLoading || models.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (status.isError) return <Card><ErrorState message={errorMessage(status.error)} onRetry={() => status.refetch()} /></Card>;
  const s = status.data;
  const info = models.data?.info;
  const det = info?.detector;
  const depth = info?.depth;
  const evaluations = models.data?.evaluations ?? [];

  return (
    <>
      <PageHeader title="AI model" description="The pretrained checkpoints in use, their status and licence. No model is trained or fine-tuned by this application." />
      {!s.reachable ? (
        <Notice tone="danger" icon={<AlertTriangle />} title="AI service is not reachable" className="mb-6">
          {s.error}. Uploads are accepted and queued, and will be processed automatically once the service is running (see Help → Troubleshooting).
        </Notice>
      ) : !s.detector?.ready ? (
        <Notice tone="warn" icon={<AlertTriangle />} title={`Detector status: ${s.detector?.status}`} className="mb-6">
          {s.detector?.error ?? 'The model is still loading. Detection will start once it is ready.'}
        </Notice>
      ) : (
        <Notice tone="ok" icon={<CheckCircle2 />} title="Detector ready" className="mb-6">
          Loaded in {s.detector.loadSeconds}s on {s.detector.device}. {s.detector.inferenceCount} inference(s) since start
          {s.detector.lastInferenceMs ? `, last took ${Math.round(s.detector.lastInferenceMs)} ms` : ''}.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Pothole detector" description={det?.sourceNote} actions={<Cpu className="size-5 text-muted" />} />
          <CardBody>
            {det && !info.error ? (
              <>
                <DefinitionList
                  items={[
                    ['Repository', <span className="font-mono text-xs">{det.repositoryId}</span>],
                    ['Revision', <span className="font-mono text-xs">{det.revision}{det.revisionPinned ? '' : ' (not pinned)'}</span>],
                    ['Checkpoint', <span className="font-mono text-xs">{det.checkpoint}</span>],
                    ['Task', det.task === 'segment' ? 'Segmentation (masks + boxes)' : 'Detection (boxes)'],
                    ['Class labels', det.classLabels?.join(', ')],
                    ['Framework', `${det.framework} ${det.frameworkVersion ?? ''} · torch ${det.torchVersion ?? ''}`],
                    ['Device', det.device],
                    ['Service thresholds', `confidence ${det.confidenceThreshold} · NMS IoU ${det.iouThreshold} · ${det.imageSize}px`],
                    ['Application threshold', `${models.data.applicationThresholds.confidenceThreshold} (review below ${models.data.applicationThresholds.reviewConfidenceBelow})`],
                    ['Licence', det.licence],
                    ['Trained by this project', det.trainedByThisProject ? 'Yes' : 'No — pretrained checkpoint'],
                  ]}
                />
                {det.licenceNote && <p className="mt-3 text-xs text-muted">{det.licenceNote}</p>}
              </>
            ) : (
              <p className="text-[13px] text-muted">{info?.error ?? 'Model information unavailable.'}</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Depth model" description="Relative depth only" actions={<Layers className="size-5 text-muted" />} />
          <CardBody>
            {depth ? (
              <>
                <DefinitionList
                  items={[
                    ['Status', depth.enabled ? <Badge tone={depth.status === 'ready' ? 'ok' : depth.status === 'error' ? 'danger' : 'neutral'}>{depth.status}</Badge> : 'Disabled'],
                    ['Repository', <span className="font-mono text-xs">{depth.repositoryId}</span>],
                    ['Revision', <span className="font-mono text-xs">{depth.revision ?? '—'}</span>],
                    ['Output', depth.output],
                    ['Licence', depth.licence],
                  ]}
                />
                {depth.error && <p className="mt-2 text-xs text-danger">{depth.error}</p>}
                <p className="mt-3 text-xs text-muted">
                  Relative depth becomes metres only with a camera profile that has a depth factor fitted against hand measurements and a known camera height. Otherwise depth must be measured and entered.
                </p>
              </>
            ) : (
              <p className="text-[13px] text-muted">Unavailable.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Evaluation results" description="Shown only when an evaluation was actually run on labelled images and recorded by an administrator." />
        {evaluations.length === 0 ? (
          <CardBody>
            <p className="text-[13px] text-muted">
              No evaluation has been recorded for this deployment, so no precision, recall or mAP figures are shown. Run <span className="font-mono">ai-service/scripts/evaluate_model.py</span> on a labelled
              local test set and record the results through the API.
            </p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Model version</Th>
                <Th>Dataset</Th>
                <Th className="text-right">Images</Th>
                <Th className="text-right">Precision</Th>
                <Th className="text-right">Recall</Th>
                <Th className="text-right">mAP@0.5</Th>
                <Th className="text-right">mAP@0.5:0.95</Th>
                <Th>Date</Th>
              </tr>
            </THead>
            <TBody>
              {evaluations.map((e: any) => (
                <Tr key={e._id}>
                  <Td className="font-mono text-xs">{e.modelVersion}</Td>
                  <Td className="max-w-[260px] text-xs">{e.datasetDescription}</Td>
                  <Td className="num text-right">{e.imageCount}</Td>
                  <Td className="num text-right">{e.precision?.toFixed(3) ?? '—'}</Td>
                  <Td className="num text-right">{e.recall?.toFixed(3) ?? '—'}</Td>
                  <Td className="num text-right">{e.mAP50?.toFixed(3) ?? '—'}</Td>
                  <Td className="num text-right">{e.mAP50_95?.toFixed(3) ?? '—'}</Td>
                  <Td>{fmt.date(e.evaluatedAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
