import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, Info, MousePointerClick, RotateCcw } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { Pothole, Upload } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, DefinitionList, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';
import { AuthedImage } from '@/components/domain';

interface Pt {
  x: number;
  y: number;
}

const PRESETS: Array<[string, string, number]> = [
  ['a4-long', 'A4 sheet — long side', 0.297],
  ['a4-short', 'A4 sheet — short side', 0.21],
  ['ruler-30', '30 cm ruler', 0.3],
  ['ruler-1m', '1 m measuring rod', 1.0],
  ['custom', 'Other object (enter length)', 0],
];

export default function CalibrationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [preset, setPreset] = useState('a4-long');
  const [customLength, setCustomLength] = useState('');
  const [note, setNote] = useState('');

  const q = useQuery({ queryKey: ['upload', id], queryFn: async () => (await api.get<{ upload: Upload; potholes: Pothole[] }>(`/uploads/${id}`)).data });
  const history = useQuery({ queryKey: ['calibrations', id], queryFn: async () => (await api.get('/calibrations', { params: { uploadId: id } })).data.items as any[] });

  const lengthM = preset === 'custom' ? Number(customLength) : PRESETS.find((p) => p[0] === preset)![2];
  const pixelLength = points.length === 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : null;
  const scale = pixelLength && lengthM > 0 && pixelLength >= 5 ? lengthM / pixelLength : null;

  const preview = useMemo(() => {
    if (!scale || !q.data) return [];
    return q.data.potholes.map((p) => {
      const bw = p.bbox.x2 - p.bbox.x1;
      const bh = p.bbox.y2 - p.bbox.y1;
      return { code: p.code, L: Math.max(bw, bh) * scale, W: Math.min(bw, bh) * scale };
    });
  }, [scale, q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.post('/calibrations', {
        uploadId: id,
        referenceLabel: PRESETS.find((p) => p[0] === preset)![1],
        referenceLengthM: lengthM,
        point1: { x: Math.round(points[0].x * 10) / 10, y: Math.round(points[0].y * 10) / 10 },
        point2: { x: Math.round(points[1].x * 10) / 10, y: Math.round(points[1].y * 10) / 10 },
        note: note || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Calibration saved — ${r.data.potholesUpdated} pothole(s) re-measured`);
      qc.invalidateQueries({ queryKey: ['upload', id] });
      qc.invalidateQueries({ queryKey: ['potholes'] });
      navigate(`/app/uploads/${id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Card><LoadingBlock rows={8} /></Card>;
  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const { upload, potholes } = q.data!;
  if (upload.kind !== 'image' || upload.status !== 'completed') {
    return <Notice tone="warn">Reference calibration is available for single images after detection has completed.</Notice>;
  }

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!natural) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * natural.w;
    const y = ((e.clientY - rect.top) / rect.height) * natural.h;
    setPoints((cur) => (cur.length >= 2 ? [{ x, y }] : [...cur, { x, y }]));
  };

  const setCoord = (i: number, axis: 'x' | 'y', v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    setPoints((cur) => {
      const next = [...cur];
      while (next.length <= i) next.push({ x: 0, y: 0 });
      next[i] = { ...next[i], [axis]: n };
      return next;
    });
  };

  return (
    <>
      <Link to={`/app/uploads/${id}`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to results
      </Link>
      <PageHeader title="Calibrate image" description="Click the two ends of an object of known length lying on the road near the pothole. The pixel-to-metre scale applies only near that object's plane." />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader
            title={upload.originalName}
            description={
              <span className="flex items-center gap-1.5">
                <MousePointerClick className="size-3.5" />
                {points.length === 0 ? 'Click the first end of the reference object' : points.length === 1 ? 'Click the second end' : 'Click again to start over'}
              </span>
            }
            actions={
              <Button variant="ghost" size="sm" onClick={() => setPoints([])} disabled={!points.length}>
                <RotateCcw /> Reset points
              </Button>
            }
          />
          <div className="bg-graphite-950 p-2">
            <div className="relative mx-auto w-fit cursor-crosshair select-none" onClick={onClick} role="application" aria-label="Calibration image. Click two points, or type coordinates in the panel.">
              <AuthedImage
                src={`/uploads/${id}/original`}
                alt="Original photograph for calibration"
                className="block max-h-[620px] w-auto"
                fallbackClassName="h-80 w-[480px]"
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                draggable={false}
              />
              {natural && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${natural.w} ${natural.h}`} preserveAspectRatio="none" aria-hidden>
                  {potholes.map((p) => (
                    <rect key={p._id} x={p.bbox.x1} y={p.bbox.y1} width={p.bbox.x2 - p.bbox.x1} height={p.bbox.y2 - p.bbox.y1} fill="none" stroke="#f59e0b" strokeWidth={natural.w / 400} strokeDasharray={`${natural.w / 80} ${natural.w / 160}`} opacity={0.8} />
                  ))}
                  {points.length === 2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke="#22d3ee" strokeWidth={natural.w / 250} />}
                  {points.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={natural.w / 90} fill="#22d3ee" stroke="#0e7490" strokeWidth={natural.w / 500} />
                      <text x={p.x + natural.w / 60} y={p.y - natural.w / 60} fill="#fff" fontSize={natural.w / 35} fontWeight={600} stroke="#000" strokeWidth={natural.w / 600}>
                        {i + 1}
                      </text>
                    </g>
                  ))}
                </svg>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Reference object" />
            <CardBody className="space-y-4">
              <Field label="Object">
                {(p) => (
                  <Select {...p} value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {PRESETS.map(([k, t, l]) => (
                      <option key={k} value={k}>
                        {t}
                        {l ? ` (${l} m)` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {preset === 'custom' && (
                <Field label="Known length (m)" error={customLength && !(Number(customLength) > 0) ? 'Enter a positive length' : undefined}>
                  {(p) => <Input {...p} type="number" min="0.01" step="0.001" value={customLength} onChange={(e) => setCustomLength(e.target.value)} />}
                </Field>
              )}
              <fieldset className="grid grid-cols-2 gap-3">
                <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Points (image pixels)</legend>
                {[0, 1].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="text-xs text-muted">Point {i + 1}</div>
                    <div className="flex gap-1.5">
                      <Input aria-label={`Point ${i + 1} x`} type="number" value={points[i] ? Math.round(points[i].x) : ''} onChange={(e) => setCoord(i, 'x', e.target.value)} placeholder="x" />
                      <Input aria-label={`Point ${i + 1} y`} type="number" value={points[i] ? Math.round(points[i].y) : ''} onChange={(e) => setCoord(i, 'y', e.target.value)} placeholder="y" />
                    </div>
                  </div>
                ))}
              </fieldset>
              <Field label="Note (optional)">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. A4 sheet placed at the pothole edge" />}</Field>
              <DefinitionList
                items={[
                  ['Pixel length', pixelLength ? `${pixelLength.toFixed(1)} px` : '—'],
                  ['Scale', scale ? `${scale.toFixed(5)} m/px` : '—'],
                ]}
              />
              {pixelLength !== null && pixelLength < 30 && <Notice tone="warn">The points are very close together; small click errors will distort the scale. Zoom your browser or use a longer reference.</Notice>}
              <Button className="w-full" onClick={() => save.mutate()} disabled={!scale} loading={save.isPending}>
                <Check /> Save calibration
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Preview" description="Bounding-box length × width with this scale" />
            <CardBody>
              {preview.length ? (
                <DefinitionList items={preview.map((p) => [p.code, `${fmt.m(p.L)} × ${fmt.m(p.W)}`])} />
              ) : (
                <p className="text-[13px] text-muted">Place both points to preview dimensions.</p>
              )}
              <p className="mt-3 flex gap-1.5 text-xs text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Depth is not set by calibration. Volume and cost appear after a measured depth is entered on each pothole (or with a camera profile that has a fitted depth factor).
              </p>
            </CardBody>
          </Card>

          {!!history.data?.length && (
            <Card>
              <CardHeader title="Calibration history" />
              <ul className="divide-y divide-line text-[13px]">
                {history.data.map((c) => (
                  <li key={c._id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div>
                      <div className="text-ink">
                        {c.referenceLabel ?? c.method} · {c.metresPerPixel.toFixed(5)} m/px
                      </div>
                      <div className="text-xs text-muted">
                        {c.createdBy?.name} · {fmt.relative(c.createdAt)} · {c.reviewStatus}
                      </div>
                    </div>
                    <span className={c.active ? 'text-xs font-medium text-ok' : 'text-xs text-muted'}>{c.active ? 'Active' : 'Superseded'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
