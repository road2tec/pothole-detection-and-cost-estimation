import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { AlertTriangle, ArrowLeft, Check, Flag, History, Pencil, Ruler, ShieldCheck, Wrench, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { Pothole } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { severityIcon } from '@/features/map/markers';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, DefinitionList, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';
import { Dialog, Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { AuthedImage, ConfidenceMeter, DemoBadge, MeasurementBadge, RepairBadge, SeverityBadge, VerificationBadge } from '@/components/domain';

type P = Pothole & { upload: any; costConfig?: any; repairVisit?: any };

function useAct(id: string) {
  const qc = useQueryClient();
  return (path: string, method: 'patch' | 'post', success: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useMutation({
      mutationFn: (body: unknown) => api[method](`/potholes/${id}/${path}`, body),
      onSuccess: () => {
        toast.success(success);
        qc.invalidateQueries({ queryKey: ['pothole', id] });
        qc.invalidateQueries({ queryKey: ['potholes'] });
        qc.invalidateQueries({ queryKey: ['analytics'] });
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
}

function MeasurementDialog({ p, open, onOpenChange }: { p: P; open: boolean; onOpenChange: (o: boolean) => void }) {
  const act = useAct(p._id);
  const m = act('measurements', 'patch', 'Measurements updated and estimate recalculated');
  const [L, setL] = useState(p.lengthM?.toString() ?? '');
  const [W, setW] = useState(p.widthM?.toString() ?? '');
  const [D, setD] = useState(p.depthM?.toString() ?? '');
  const [reason, setReason] = useState('');
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const body = () => {
    const out: Record<string, unknown> = { reason };
    const l = num(L);
    const w = num(W);
    const d = num(D);
    if (l !== p.lengthM || w !== p.widthM) {
      if (l !== undefined && w !== undefined) Object.assign(out, { lengthM: l, widthM: w });
    }
    if (d !== (p.depthM ?? undefined)) out.depthM = d ?? null;
    return out;
  };
  const invalid = [L, W, D].some((s) => s.trim() !== '' && !(Number(s) > 0)) || reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Correct measurements"
      description="Manual values are recorded as measured (not estimated), kept through recalibration, and logged with your reason."
      footer={
        <>
          {(p.dimensionSource === 'manual' || p.depthSource === 'manual') && (
            <Button
              variant="ghost"
              onClick={() => m.mutate({ revert: [p.dimensionSource === 'manual' && 'dimensions', p.depthSource === 'manual' && 'depth'].filter(Boolean), reason: reason || 'Reverted to calculated values' }, { onSuccess: () => onOpenChange(false) })}
            >
              Revert manual values
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={invalid} loading={m.isPending} onClick={() => m.mutate(body(), { onSuccess: () => onOpenChange(false) })}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Length (m)">{(f) => <Input {...f} type="number" step="0.01" min="0" value={L} onChange={(e) => setL(e.target.value)} />}</Field>
        <Field label="Width (m)">{(f) => <Input {...f} type="number" step="0.01" min="0" value={W} onChange={(e) => setW(e.target.value)} />}</Field>
        <Field label="Depth (m)">{(f) => <Input {...f} type="number" step="0.005" min="0" value={D} onChange={(e) => setD(e.target.value)} />}</Field>
      </div>
      <Field label="Reason" required className="mt-4" hint="e.g. Measured on site with tape and ruler">
        {(f) => <Textarea {...f} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

function ReviewCard({ p }: { p: P }) {
  const act = useAct(p._id);
  const m = act('review', 'patch', 'Review saved');
  const [severity, setSeverity] = useState<string>(p.verifiedSeverity ?? '');
  const [note, setNote] = useState('');
  const changed = severity !== '' && severity !== p.calculatedSeverity;
  return (
    <Card>
      <CardHeader title="Engineer review" description={p.reviewedBy ? `Last reviewed by ${p.reviewedBy.name} ${fmt.relative(p.reviewedAt)}` : 'Not yet reviewed'} />
      <CardBody className="space-y-4">
        {p.reviewReasons && p.reviewReasons.length > 0 && (
          <Notice tone="warn" icon={<AlertTriangle />} title="Flagged for attention">
            <ul className="list-disc pl-4">
              {p.reviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Notice>
        )}
        <Field label="Verified severity" hint={`Calculated: ${label('severity', p.calculatedSeverity ?? 'unclassified')}. The calculated value is always kept.`}>
          {(f) => (
            <Select {...f} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Use calculated severity</option>
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </Select>
          )}
        </Field>
        <Field label={changed ? 'Reason (required for override or rejection)' : 'Note (required to reject)'}>
          {(f) => <Textarea {...f} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => m.mutate({ decision: 'verified', verifiedSeverity: severity || null, note: note || undefined })} disabled={changed && note.trim().length < 3} loading={m.isPending && (m.variables as any)?.decision === 'verified'}>
            <Check /> Verify
          </Button>
          <Button variant="danger" onClick={() => m.mutate({ decision: 'rejected', note })} disabled={note.trim().length < 3} loading={m.isPending && (m.variables as any)?.decision === 'rejected'}>
            <X /> Reject detection
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function StatusCard({ p }: { p: P }) {
  const act = useAct(p._id);
  const m = act('status', 'patch', 'Repair status updated');
  const [status, setStatus] = useState(p.repairStatus);
  const [actual, setActual] = useState(p.actualRepairCost?.toString() ?? '');
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader title="Repair status" description={p.repairVisit ? `Work order ${p.repairVisit.code} — ${p.repairVisit.title}` : 'Not assigned to a work order'} />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            {(f) => (
              <Select {...f} value={status} onChange={(e) => setStatus(e.target.value as P['repairStatus'])}>
                <option value="reported">Reported</option>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In progress</option>
                <option value="repaired">Repaired</option>
                <option value="deferred">Deferred</option>
              </Select>
            )}
          </Field>
          <Field label="Actual repair cost (₹)" hint="Verified expenditure, if known">
            {(f) => <Input {...f} type="number" min="0" step="1" value={actual} onChange={(e) => setActual(e.target.value)} />}
          </Field>
        </div>
        <Field label="Note">{(f) => <Input {...f} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Button onClick={() => m.mutate({ repairStatus: status, actualRepairCost: actual === '' ? null : Number(actual), note: note || undefined })} loading={m.isPending} disabled={p.verificationStatus === 'rejected'}>
          <Wrench /> Update status
        </Button>
      </CardBody>
    </Card>
  );
}

function LocationCard({ p, canEdit }: { p: P; canEdit: boolean }) {
  const act = useAct(p._id);
  const m = act('location', 'patch', 'Location updated');
  const coords = p.location?.coordinates;
  const [edit, setEdit] = useState(false);
  const [lat, setLat] = useState(coords ? String(coords[1]) : '');
  const [lon, setLon] = useState(coords ? String(coords[0]) : '');
  const [reason, setReason] = useState('');
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Location"
        description={coords ? `Source: ${p.locationSource ?? 'unknown'}${p.locationVerified ? ' · verified' : ''}` : 'No coordinates recorded — not shown on the map'}
        actions={
          canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setEdit((e) => !e)}>
              <Pencil /> {coords ? 'Correct' : 'Add'}
            </Button>
          )
        }
      />
      {coords && (
        <div className="h-48">
          <MapContainer center={[coords[1], coords[0]]} zoom={17} scrollWheelZoom={false} className="h-full w-full" attributionControl>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <Marker position={[coords[1], coords[0]]} icon={severityIcon(p.severity)} />
          </MapContainer>
        </div>
      )}
      <CardBody>
        <DefinitionList
          items={[
            ['Road', p.roadName ?? '—'],
            ['Locality / ward', [p.locality, p.ward].filter(Boolean).join(' · ') || '—'],
            ['Coordinates', coords ? `${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}` : 'Not recorded'],
          ]}
        />
        {edit && (
          <div className="mt-4 space-y-3 rounded-lg border border-line bg-[#faf9f6] p-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">{(f) => <Input {...f} value={lat} onChange={(e) => setLat(e.target.value)} />}</Field>
              <Field label="Longitude">{(f) => <Input {...f} value={lon} onChange={(e) => setLon(e.target.value)} />}</Field>
            </div>
            <Field label="Reason" required>
              {(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Verified on site with handheld GPS" />}
            </Field>
            <div className="flex gap-2">
              <Button size="sm" disabled={reason.trim().length < 3 || !(Number(lat) || lat === '') } loading={m.isPending} onClick={() => m.mutate({ lat: lat === '' ? null : Number(lat), lon: lon === '' ? null : Number(lon), verified: true, reason }, { onSuccess: () => setEdit(false) })}>
                Save location
              </Button>
              {coords && (
                <Button size="sm" variant="ghost" disabled={reason.trim().length < 3} onClick={() => m.mutate({ lat: null, lon: null, reason }, { onSuccess: () => setEdit(false) })}>
                  Remove coordinates
                </Button>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function PotholeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const staff = user!.role !== 'inspector';
  const [img, setImg] = useState<'annotated' | 'crop' | 'frame'>('annotated');
  const [measureOpen, setMeasureOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const q = useQuery({ queryKey: ['pothole', id], queryFn: async () => (await api.get<{ pothole: P; observations: number }>(`/potholes/${id}`)).data });
  const act = useAct(id!);
  const flag = act('flag', 'post', 'Flag saved');

  if (q.isLoading) return <Card><LoadingBlock rows={10} /></Card>;
  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const p = q.data!.pothole;
  const cfg = p.costConfig;
  const inspectorLocked = !staff && (p.verificationStatus === 'verified' || p.verificationStatus === 'rejected');
  const flags = p.measurementFlags ?? [];

  return (
    <>
      <Link to={staff ? '/app/potholes' : '/app/potholes'} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Potholes
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.code}
            <SeverityBadge severity={p.severity} />
            <VerificationBadge status={p.verificationStatus} />
            <RepairBadge status={p.repairStatus} />
            {p.isDemo && <DemoBadge />}
          </span>
        }
        description={`Detected ${fmt.dateTime(p.detectedAt)} from ${p.sourceType === 'video' ? `video (track ${p.trackId}, ${p.observationCount} frames)` : 'a photograph'}`}
        actions={
          <>
            {typeof p.upload === 'object' && (
              <Button variant="secondary" asChild>
                <Link to={`/app/uploads/${p.upload._id}`}>Open upload</Link>
              </Button>
            )}
            {!staff && !inspectorLocked && (
              <Button variant="secondary" onClick={() => setFlagOpen(true)}>
                <Flag /> {p.inspectorFlag?.flagged ? 'Update flag' : 'Flag as incorrect'}
              </Button>
            )}
            {!inspectorLocked && (
              <Button onClick={() => setMeasureOpen(true)}>
                <Ruler /> Correct measurements
              </Button>
            )}
          </>
        }
      />
      {p.isDemo && (
        <Notice tone="neutral" className="mb-6" title="Demo record">
          This record was created by the demo seed script. It was not detected by the AI model.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader
              title="Evidence"
              actions={
                <Tabs value={img} onValueChange={(v) => setImg(v as typeof img)}>
                  <TabsList>
                    <TabsTrigger value="annotated">Annotated</TabsTrigger>
                    <TabsTrigger value="crop">Crop</TabsTrigger>
                    <TabsTrigger value="frame">{p.sourceType === 'video' ? 'Best frame' : 'Original'}</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            />
            <div className="bg-graphite-950">
              <AuthedImage key={img} src={`/potholes/${p._id}/${img}`} alt={`${img} image of ${p.code}`} className="mx-auto max-h-[480px] w-auto object-contain" fallbackClassName="h-64" />
            </div>
            <CardBody>
              <DefinitionList
                items={[
                  ['Class / confidence', <span className="flex items-center justify-end gap-2">{p.classLabel} <ConfidenceMeter value={p.confidence} /></span>],
                  ['Model version', <span className="break-all font-mono text-xs">{p.modelVersion}</span>],
                  ['Bounding box (px)', `${Math.round(p.bbox.x1)}, ${Math.round(p.bbox.y1)} → ${Math.round(p.bbox.x2)}, ${Math.round(p.bbox.y2)}`],
                  ['Segmentation mask', p.maskPolygon?.length ? `${p.maskPolygon.length}-point outline` : 'Not provided by this model'],
                  ['Frame-level observations', fmt.int(q.data!.observations)],
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Measurements" description="Each value shows how it was obtained" actions={<MeasurementBadge status={p.measurementStatus} />} />
            <CardBody className="space-y-4">
              {p.measurementStatus === 'not_calibrated' && (
                <Notice tone="warn" icon={<Ruler />} title="Not calibrated">
                  No reference scale exists for this image, so length, width, volume and cost are not estimated.{' '}
                  {typeof p.upload === 'object' && p.sourceType === 'image' && (
                    <Link className="font-medium underline" to={`/app/uploads/${p.upload._id}/calibrate`}>
                      Calibrate the image
                    </Link>
                  )}
                </Notice>
              )}
              {p.measurementStatus === 'depth_unavailable' && (
                <Notice tone="info" title="Depth not available in metres">
                  {flags.includes('depth_implausible')
                    ? 'The scaled depth exceeded the plausibility limit and was withheld for manual review.'
                    : 'The depth model gives relative depth only. Enter a measured depth to estimate volume and cost.'}
                </Notice>
              )}
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ['Length', fmt.m(p.lengthM), label('dimensionSource', p.dimensionSource)],
                  ['Width', fmt.m(p.widthM), label('dimensionSource', p.dimensionSource)],
                  ['Depth', fmt.m(p.depthM, 3), p.depthSource ? label('depthSource', p.depthSource) : p.depthRelative ? `Relative only (${p.depthRelative.toFixed(3)})` : '—'],
                  ['Volume', fmt.m3(p.volumeM3), 'V = (π/4)·L·W·D'],
                ].map(([k, v, s]) => (
                  <div key={k} className="rounded-lg border border-line p-3">
                    <div className="text-xs text-muted">{k}</div>
                    <div className="num mt-1 text-lg font-semibold text-ink">{v}</div>
                    <div className="mt-1 text-[11.5px] leading-snug text-muted">{s}</div>
                  </div>
                ))}
              </div>
              <DefinitionList
                items={[
                  ['Scale', p.metresPerPixel ? `${p.metresPerPixel.toFixed(5)} m/px` : '—'],
                  ['Calculated severity', label('severity', p.calculatedSeverity ?? 'unclassified')],
                  ['Verified severity', p.verifiedSeverity ? label('severity', p.verifiedSeverity) : 'Not overridden'],
                  ['Severity bands', cfg ? `Minor < ${cfg.minorMaxM3} m³ ≤ Moderate < ${cfg.severeMinM3} m³ ≤ Severe` : '—'],
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Estimated repair cost" description={cfg ? `Cost configuration v${cfg.version}${cfg.isPrototypeDefault ? ' — prototype placeholder rates' : ''}` : 'Not estimated'} />
            <CardBody>
              {p.variableCost == null ? (
                <p className="text-[13px] text-muted">A cost is estimated only when length, width and depth are all known. It is not shown as zero.</p>
              ) : (
                <>
                  <DefinitionList
                    items={[
                      [`Material (${fmt.m3(p.volumeM3)} × ${fmt.inr(cfg?.materialPerM3)}/m³)`, fmt.inr(p.materialCost)],
                      [`Labour (× ${fmt.inr(cfg?.labourPerM3)}/m³)`, fmt.inr(p.labourCost)],
                      ['Mobilisation (if repaired on its own visit)', fmt.inr(p.singleVisitMobilisation)],
                      [<span className="font-semibold text-ink">Single-visit estimate</span>, <span className="font-semibold">{fmt.inr(p.singleVisitTotal)}</span>],
                    ]}
                  />
                  <p className="mt-3 text-xs text-muted">Budgets add mobilisation once per repair visit, so grouping potholes into one work order lowers the total. This is an estimate, not expenditure.</p>
                </>
              )}
              {p.actualRepairCost != null && <div className="mt-3 rounded-md bg-subtle px-3 py-2 text-[13px]">Actual repair cost recorded: <span className="num font-semibold">{fmt.inr(p.actualRepairCost)}</span></div>}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {staff && p.verificationStatus !== 'unsubmitted' && <ReviewCard p={p} />}
          {staff && p.verificationStatus === 'unsubmitted' && (
            <Notice tone="neutral" icon={<ShieldCheck />} title="Not yet submitted by the inspector">
              You can still correct measurements. Review opens once the upload is submitted.
            </Notice>
          )}
          {staff && <StatusCard p={p} />}
          {!staff && p.inspectorFlag?.flagged && (
            <Notice tone="warn" icon={<Flag />} title="You flagged this detection">
              {p.inspectorFlag.reason}
            </Notice>
          )}
          <LocationCard p={p} canEdit={staff} />
          <Card>
            <CardHeader title={`Priority score ${Math.round(p.priorityScore)}`} description="Configurable rules; no traffic or accident data is assumed" />
            <CardBody>
              <ul className="space-y-1.5 text-[13px] text-ink-2">
                {(p.priorityReasons ?? []).map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                    {r}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ol className="relative space-y-4 px-5 py-4">
              {(p.history ?? [])
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i} className="flex gap-3 text-[13px]">
                    <History className="mt-0.5 size-4 shrink-0 text-muted" />
                    <div>
                      <div className="text-ink">
                        <span className="font-medium">{h.action.replace(/[._]/g, ' ')}</span>
                        {h.by && <span className="text-muted"> by {h.by.name}</span>}
                      </div>
                      {h.note && <div className="text-muted">{h.note}</div>}
                      <div className="text-xs text-faint">{fmt.dateTime(h.at)}</div>
                    </div>
                  </li>
                ))}
            </ol>
          </Card>
        </div>
      </div>

      {measureOpen && <MeasurementDialog p={p} open={measureOpen} onOpenChange={setMeasureOpen} />}
      <Dialog
        open={flagOpen}
        onOpenChange={setFlagOpen}
        title="Flag as incorrect detection"
        description="Tell the reviewing engineer what is wrong (e.g. shadow, manhole cover, patch)."
        footer={
          <>
            {p.inspectorFlag?.flagged && (
              <Button variant="ghost" onClick={() => flag.mutate({ reason: 'Flag removed', flagged: false }, { onSuccess: () => setFlagOpen(false) })}>
                Remove flag
              </Button>
            )}
            <Button disabled={flagReason.trim().length < 3} loading={flag.isPending} onClick={() => flag.mutate({ reason: flagReason, flagged: true }, { onSuccess: () => setFlagOpen(false) })}>
              Save flag
            </Button>
          </>
        }
      >
        <Textarea aria-label="Reason" rows={3} value={flagReason} onChange={(e) => setFlagReason(e.target.value)} placeholder="This is a shadow, not a pothole" />
      </Dialog>
    </>
  );
}
