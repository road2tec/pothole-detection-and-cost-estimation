import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator, Camera, Cpu, Gauge, MapPinned, Plus, RefreshCw, Save, Target } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { CameraProfile, CostConfig } from '@/lib/types';
import { usePlaces } from '@/features/potholes/filters';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

function useSave(path: string, method: 'put' | 'post' = 'put', keys: string[][] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api[method](path, body),
    onSuccess: () => {
      toast.success('Saved');
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

const numField = (v: string) => (v === '' ? NaN : Number(v));

function CostRates() {
  const q = useQuery({ queryKey: ['settings', 'cost-rates'], queryFn: async () => (await api.get<{ active: CostConfig; history: CostConfig[] }>('/settings/cost-rates')).data });
  const save = useSave('/settings/cost-rates', 'put', [['settings', 'cost-rates']]);
  const recalc = useSave('/potholes/recalculate', 'post', [['potholes'], ['analytics']]);
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) {
      const a = q.data.active;
      setF({ materialPerM3: String(a.materialPerM3), labourPerM3: String(a.labourPerM3), mobilisationPerVisit: String(a.mobilisationPerVisit), minorMaxM3: String(a.minorMaxM3), severeMinM3: String(a.severeMinM3), depthPlausibilityMaxM: String(a.depthPlausibilityMaxM ?? 0.5), note: '' });
    }
  }, [q.data]);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const a = q.data!.active;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const minor = numField(f.minorMaxM3);
  const severe = numField(f.severeMinM3);
  const limitsInvalid = !(minor > 0 && severe > minor);
  return (
    <div className="space-y-6">
      {a.isPrototypeDefault && (
        <Notice tone="warn" title="Prototype placeholder rates are active">
          These are the preliminary report's test values (₹25,000/m³ material, ₹6,000/m³ labour, ₹500/visit). Replace them with your authorised Schedule of Rates before using estimates for budgeting.
        </Notice>
      )}
      <Card>
        <CardHeader title={`Cost rates & severity bands — active version ${a.version}`} description="Saving creates a new version. Existing estimates keep their version until you recalculate." />
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Material (₹ per m³)" required>{(p) => <Input {...p} type="number" min="0" value={f.materialPerM3 ?? ''} onChange={set('materialPerM3')} />}</Field>
            <Field label="Labour (₹ per m³)" required>{(p) => <Input {...p} type="number" min="0" value={f.labourPerM3 ?? ''} onChange={set('labourPerM3')} />}</Field>
            <Field label="Mobilisation (₹ per repair visit)" required>{(p) => <Input {...p} type="number" min="0" value={f.mobilisationPerVisit ?? ''} onChange={set('mobilisationPerVisit')} />}</Field>
            <Field label="Minor below V₁ (m³)" required error={limitsInvalid ? 'Need 0 < V₁ < V₂' : undefined}>{(p) => <Input {...p} type="number" step="0.001" min="0" value={f.minorMaxM3 ?? ''} onChange={set('minorMaxM3')} />}</Field>
            <Field label="Severe at or above V₂ (m³)" required>{(p) => <Input {...p} type="number" step="0.001" min="0" value={f.severeMinM3 ?? ''} onChange={set('severeMinM3')} />}</Field>
            <Field label="Depth plausibility limit (m)" hint="Model depths above this are flagged">{(p) => <Input {...p} type="number" step="0.05" min="0" value={f.depthPlausibilityMaxM ?? ''} onChange={set('depthPlausibilityMaxM')} />}</Field>
          </div>
          <Field label="Change note" hint="e.g. PWD Schedule of Rates 2026–27, item 4.2">{(p) => <Textarea {...p} rows={2} value={f.note ?? ''} onChange={set('note')} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={limitsInvalid}
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  materialPerM3: numField(f.materialPerM3),
                  labourPerM3: numField(f.labourPerM3),
                  mobilisationPerVisit: numField(f.mobilisationPerVisit),
                  minorMaxM3: minor,
                  severeMinM3: severe,
                  depthPlausibilityMaxM: numField(f.depthPlausibilityMaxM),
                  note: f.note || undefined,
                })
              }
            >
              <Save /> Save as new version
            </Button>
            <Button variant="secondary" loading={recalc.isPending} onClick={() => recalc.mutate({})}>
              <RefreshCw /> Recalculate open potholes with v{a.version}
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Version history" />
        <Table>
          <THead>
            <tr>
              <Th>Version</Th>
              <Th className="text-right">Material</Th>
              <Th className="text-right">Labour</Th>
              <Th className="text-right">Mobilisation</Th>
              <Th>Bands (m³)</Th>
              <Th>Changed</Th>
              <Th>Note</Th>
            </tr>
          </THead>
          <TBody>
            {q.data!.history.map((h) => (
              <Tr key={h.version}>
                <Td>
                  v{h.version} {h.active && <Badge tone="ok">Active</Badge>}
                </Td>
                <Td className="num text-right">{fmt.inr(h.materialPerM3)}</Td>
                <Td className="num text-right">{fmt.inr(h.labourPerM3)}</Td>
                <Td className="num text-right">{fmt.inr(h.mobilisationPerVisit)}</Td>
                <Td className="num">
                  {h.minorMaxM3} / {h.severeMinM3}
                </Td>
                <Td>
                  {fmt.date(h.validFrom)}
                  <div className="text-xs text-muted">{h.changedBy?.name ?? (h.isPrototypeDefault ? 'System default' : '—')}</div>
                </Td>
                <Td className="max-w-[260px] text-xs">{h.note}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

function KeyValueSettings() {
  const model = useQuery({ queryKey: ['settings', 'model'], queryFn: async () => (await api.get('/settings/model')).data.value });
  const processing = useQuery({ queryKey: ['settings', 'processing'], queryFn: async () => (await api.get('/settings/processing')).data.value });
  const budget = useQuery({ queryKey: ['settings', 'budget'], queryFn: async () => (await api.get('/settings/budget')).data.value });
  const saveModel = useSave('/settings/model', 'put', [['settings', 'model']]);
  const saveProc = useSave('/settings/processing', 'put', [['settings', 'processing']]);
  const saveBudget = useSave('/settings/budget', 'put', [['settings', 'budget'], ['analytics']]);
  const [m, setM] = useState<any>(null);
  const [p, setP] = useState<any>(null);
  const [b, setB] = useState<any>(null);
  useEffect(() => model.data && setM(model.data), [model.data]);
  useEffect(() => processing.data && setP(processing.data), [processing.data]);
  useEffect(() => budget.data && setB(budget.data), [budget.data]);
  if (!m || !p || !b) return <LoadingBlock />;
  const n = (setter: (f: (x: any) => any) => void, k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setter((x: any) => ({ ...x, [k]: Number(e.target.value) }));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Detection thresholds" description="Applied to new uploads" />
        <CardBody className="space-y-4">
          <Field label="Confidence threshold" hint="Detections below this are discarded (report default 0.40)">{(f) => <Input {...f} type="number" step="0.01" min="0.05" max="0.95" value={m.confidenceThreshold} onChange={n(setM, 'confidenceThreshold')} />}</Field>
          <Field label="“Needs review” below" hint="Confidence between the threshold and this value is flagged (report default 0.60)">{(f) => <Input {...f} type="number" step="0.01" min="0.05" max="0.99" value={m.reviewConfidenceBelow} onChange={n(setM, 'reviewConfidenceBelow')} />}</Field>
          <label className="flex items-center gap-3 text-[13px] text-ink-2">
            <Switch checked={m.includeDepth} onCheckedChange={(v) => setM((x: any) => ({ ...x, includeDepth: v }))} /> Run the depth model on new images
          </label>
          <Button onClick={() => saveModel.mutate(m)} loading={saveModel.isPending}>
            <Save /> Save thresholds
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Upload & processing limits" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max image size (MB)">{(f) => <Input {...f} type="number" min="1" value={p.maxImageMB} onChange={n(setP, 'maxImageMB')} />}</Field>
            <Field label="Max video size (MB)" hint="Cannot exceed the server's MAX_VIDEO_MB">{(f) => <Input {...f} type="number" min="10" value={p.maxVideoMB} onChange={n(setP, 'maxVideoMB')} />}</Field>
            <Field label="Max files per upload">{(f) => <Input {...f} type="number" min="1" value={p.maxFilesPerUpload} onChange={n(setP, 'maxFilesPerUpload')} />}</Field>
            <Field label="Max video duration (s)">{(f) => <Input {...f} type="number" min="5" value={p.maxVideoDurationSec} onChange={n(setP, 'maxVideoDurationSec')} />}</Field>
            <Field label="Video sampling (frames/s)" hint="Report default 5 fps">{(f) => <Input {...f} type="number" step="0.5" min="0.5" max="30" value={p.videoSampleFps} onChange={n(setP, 'videoSampleFps')} />}</Field>
          </div>
          <Button onClick={() => saveProc.mutate(p)} loading={saveProc.isPending}>
            <Save /> Save limits
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Budget target" description="Used for the “budget variance” KPI. Leave empty if no approved budget exists." />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Approved budget (₹)">{(f) => <Input {...f} type="number" min="0" value={b.targetAmount ?? ''} onChange={(e) => setB((x: any) => ({ ...x, targetAmount: e.target.value === '' ? null : Number(e.target.value) }))} />}</Field>
            <Field label="Label">{(f) => <Input {...f} value={b.label} onChange={(e) => setB((x: any) => ({ ...x, label: e.target.value }))} placeholder="e.g. FY 2026–27 patching" />}</Field>
          </div>
          <Button onClick={() => saveBudget.mutate(b)} loading={saveBudget.isPending}>
            <Target /> Save budget target
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function PriorityWeights() {
  const q = useQuery({ queryKey: ['settings', 'priority'], queryFn: async () => (await api.get('/settings/priority')).data.value });
  const save = useSave('/settings/priority', 'put', [['settings', 'priority']]);
  const [w, setW] = useState<any>(null);
  useEffect(() => q.data && setW(q.data), [q.data]);
  if (!w) return <LoadingBlock />;
  const num = (path: string[]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setW((x: any) => {
      const next = structuredClone(x);
      let o = next;
      for (const k of path.slice(0, -1)) o = o[k];
      o[path[path.length - 1]] = Number(e.target.value);
      return next;
    });
  return (
    <Card>
      <CardHeader title="Repair priority scoring" description="Points added per factor. Scores refresh when a record changes and every 30 minutes for age." />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(['severe', 'moderate', 'minor', 'unmeasured'] as const).map((k) => (
            <Field key={k} label={`Severity: ${k}`}>{(f) => <Input {...f} type="number" value={w.severityWeights[k]} onChange={num(['severityWeights', k])} />}</Field>
          ))}
          <Field label="Verified bonus">{(f) => <Input {...f} type="number" value={w.verifiedBonus} onChange={num(['verifiedBonus'])} />}</Field>
          <Field label="Pending review bonus">{(f) => <Input {...f} type="number" value={w.pendingReviewBonus} onChange={num(['pendingReviewBonus'])} />}</Field>
          <Field label="Max age bonus">{(f) => <Input {...f} type="number" value={w.maxAgeBonus} onChange={num(['maxAgeBonus'])} />}</Field>
          <Field label="Full age bonus after (days)">{(f) => <Input {...f} type="number" min="1" value={w.ageFullAfterDays} onChange={num(['ageFullAfterDays'])} />}</Field>
          <Field label="Max road-importance bonus" hint="Scaled from importance 1–5">{(f) => <Input {...f} type="number" value={w.roadImportanceMaxBonus} onChange={num(['roadImportanceMaxBonus'])} />}</Field>
          <Field label="Valid GPS bonus">{(f) => <Input {...f} type="number" value={w.validLocationBonus} onChange={num(['validLocationBonus'])} />}</Field>
        </div>
        <Button onClick={() => save.mutate(w)} loading={save.isPending}>
          <Save /> Save weights
        </Button>
      </CardBody>
    </Card>
  );
}

function CameraProfiles() {
  const q = useQuery({ queryKey: ['camera-profiles'], queryFn: async () => (await api.get<{ items: CameraProfile[] }>('/camera-profiles')).data.items });
  const [editing, setEditing] = useState<CameraProfile | 'new' | null>(null);
  return (
    <Card>
      <CardHeader
        title="Camera profiles"
        description="Only for surveyed fixed mounts. A profile enables measurement without a reference object; depth in metres needs a fitted depth factor."
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New profile
          </Button>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : !q.data?.length ? (
        <CardBody>
          <p className="text-[13px] text-muted">No camera profiles. Inspectors calibrate each image with a reference object instead.</p>
        </CardBody>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Method</Th>
              <Th>Resolution</Th>
              <Th>Depth scaling</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <TBody>
            {q.data.map((c) => (
              <Tr key={c._id}>
                <Td className="font-medium text-ink">{c.name}</Td>
                <Td>{c.method === 'homography' ? 'Homography' : `Fixed scale ${c.metresPerPixel} m/px`}</Td>
                <Td className="num">{c.referenceWidthPx ? `${c.referenceWidthPx}×${c.referenceHeightPx}` : 'Any'}</Td>
                <Td>{c.depthAlpha && c.cameraHeightM ? `α ${c.depthAlpha}, Z ${c.cameraHeightM} m` : 'Not configured'}</Td>
                <Td>{c.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing && <ProfileDialog profile={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ProfileDialog({ profile, onClose }: { profile: CameraProfile | 'new'; onClose: () => void }) {
  const isNew = profile === 'new';
  const qc = useQueryClient();
  const init = isNew ? null : profile;
  const [f, setF] = useState<Record<string, string>>({
    name: init?.name ?? '',
    description: init?.description ?? '',
    method: init?.method ?? 'fixed-scale',
    metresPerPixel: init?.metresPerPixel?.toString() ?? '',
    referenceWidthPx: init?.referenceWidthPx?.toString() ?? '',
    referenceHeightPx: init?.referenceHeightPx?.toString() ?? '',
    cameraHeightM: init?.cameraHeightM?.toString() ?? '',
    tiltDeg: init?.tiltDeg?.toString() ?? '',
    depthAlpha: init?.depthAlpha?.toString() ?? '',
    depthAlphaNote: init?.depthAlphaNote ?? '',
    imagePoints: '',
    roadPointsM: '',
  });
  const [active, setActive] = useState(init?.active ?? true);
  const m = useMutation({
    mutationFn: () => {
      const num = (k: string) => (f[k] === '' ? undefined : Number(f[k]));
      const parsePts = (s: string) =>
        s
          .split(/;|\n/)
          .map((pair) => pair.trim())
          .filter(Boolean)
          .map((pair) => {
            const [x, y] = pair.split(',').map(Number);
            return { x, y };
          });
      const body: Record<string, unknown> = {
        name: f.name,
        description: f.description || undefined,
        method: f.method,
        metresPerPixel: f.method === 'fixed-scale' ? num('metresPerPixel') : undefined,
        referenceWidthPx: num('referenceWidthPx'),
        referenceHeightPx: num('referenceHeightPx'),
        cameraHeightM: num('cameraHeightM'),
        tiltDeg: num('tiltDeg'),
        depthAlpha: num('depthAlpha'),
        depthAlphaNote: f.depthAlphaNote || undefined,
        active,
      };
      if (f.method === 'homography') {
        body.imagePoints = parsePts(f.imagePoints);
        body.roadPointsM = parsePts(f.roadPointsM);
      }
      return isNew ? api.post('/camera-profiles', body) : api.put(`/camera-profiles/${(profile as CameraProfile)._id}`, body);
    },
    onSuccess: (r) => {
      toast.success(`Profile saved${r.data.potholesUpdated ? ` — ${r.data.potholesUpdated} pothole(s) re-measured` : ''}`);
      qc.invalidateQueries({ queryKey: ['camera-profiles'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'New camera profile' : `Edit ${init!.name}`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>
            Save profile
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required>{(p) => <Input {...p} value={f.name} onChange={set('name')} />}</Field>
        <Field label="Method" required>
          {(p) => (
            <Select {...p} value={f.method} onChange={set('method')}>
              <option value="fixed-scale">Fixed scale (top-down / fixed mount)</option>
              <option value="homography">Homography (4 surveyed road points)</option>
            </Select>
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={set('description')} />}</Field>
        {f.method === 'fixed-scale' ? (
          <Field label="Metres per pixel" required className="sm:col-span-2" hint="Measured for this mounting at the reference resolution">{(p) => <Input {...p} type="number" step="0.00001" value={f.metresPerPixel} onChange={set('metresPerPixel')} />}</Field>
        ) : (
          <>
            <Field label="Image points (px)" required hint="x,y; x,y; x,y; x,y">{(p) => <Textarea {...p} rows={2} value={f.imagePoints} onChange={set('imagePoints')} placeholder="412,880; 1508,880; 1250,620; 670,620" />}</Field>
            <Field label="Road-plane points (m)" required hint="Same order, metres on the road">{(p) => <Textarea {...p} rows={2} value={f.roadPointsM} onChange={set('roadPointsM')} placeholder="0,0; 2,0; 2,4; 0,4" />}</Field>
          </>
        )}
        <Field label="Reference width (px)" hint="Images at other resolutions are not measured">{(p) => <Input {...p} type="number" value={f.referenceWidthPx} onChange={set('referenceWidthPx')} />}</Field>
        <Field label="Reference height (px)">{(p) => <Input {...p} type="number" value={f.referenceHeightPx} onChange={set('referenceHeightPx')} />}</Field>
        <Field label="Camera height Z (m)">{(p) => <Input {...p} type="number" step="0.01" value={f.cameraHeightM} onChange={set('cameraHeightM')} />}</Field>
        <Field label="Tilt (degrees)">{(p) => <Input {...p} type="number" value={f.tiltDeg} onChange={set('tiltDeg')} />}</Field>
        <Field label="Depth factor α" hint="Fitted against hand-measured depths (report Eq. 4.6)">{(p) => <Input {...p} type="number" step="0.001" value={f.depthAlpha} onChange={set('depthAlpha')} />}</Field>
        <Field label="How α was fitted" hint="Required when α is set">{(p) => <Input {...p} value={f.depthAlphaNote} onChange={set('depthAlphaNote')} placeholder="e.g. 24 potholes, tape-measured, Oct 2026" />}</Field>
        <label className="flex items-center gap-3 text-[13px] text-ink-2 sm:col-span-2">
          <Switch checked={active} onCheckedChange={setActive} /> Active (available for new uploads)
        </label>
      </div>
    </Dialog>
  );
}

function Places() {
  const places = usePlaces();
  const qc = useQueryClient();
  const [area, setArea] = useState({ locality: '', ward: '', city: '', region: '' });
  const [road, setRoad] = useState({ name: '', code: '', areaId: '', importance: '3' });
  const addArea = useMutation({
    mutationFn: () => api.post('/places/areas', area),
    onSuccess: () => {
      toast.success('Area added');
      setArea({ locality: '', ward: '', city: '', region: '' });
      qc.invalidateQueries({ queryKey: ['places'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addRoad = useMutation({
    mutationFn: () => api.post('/places/roads', { ...road, importance: Number(road.importance), code: road.code || undefined }),
    onSuccess: () => {
      toast.success('Road added');
      setRoad({ name: '', code: '', areaId: '', importance: '3' });
      qc.invalidateQueries({ queryKey: ['places'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const updateRoad = useMutation({
    mutationFn: (r: { id: string; name: string; areaId: string; importance: number }) => api.put(`/places/roads/${r.id}`, { name: r.name, areaId: r.areaId, importance: r.importance }),
    onSuccess: () => {
      toast.success('Road importance updated');
      qc.invalidateQueries({ queryKey: ['places'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Wards & localities" description="Also created automatically from upload details" />
        <CardBody className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Input aria-label="Locality" placeholder="Locality" value={area.locality} onChange={(e) => setArea({ ...area, locality: e.target.value })} />
            <Input aria-label="Ward" placeholder="Ward" value={area.ward} onChange={(e) => setArea({ ...area, ward: e.target.value })} />
            <Input aria-label="City" placeholder="City" value={area.city} onChange={(e) => setArea({ ...area, city: e.target.value })} />
            <Button onClick={() => addArea.mutate()} disabled={!area.locality || !area.ward} loading={addArea.isPending}>
              <Plus /> Add
            </Button>
          </div>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line text-[13px]">
            {places.data?.areas.map((a) => (
              <li key={a._id} className="flex justify-between px-3 py-2">
                <span className="text-ink">{a.locality}</span>
                <span className="text-muted">
                  Ward {a.ward}
                  {a.city ? ` · ${a.city}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Roads" description="Importance (1–5) feeds the priority score" />
        <CardBody className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_80px_auto]">
            <Input aria-label="Road name" placeholder="Road name" value={road.name} onChange={(e) => setRoad({ ...road, name: e.target.value })} />
            <Select aria-label="Area" value={road.areaId} onChange={(e) => setRoad({ ...road, areaId: e.target.value })}>
              <option value="">Area…</option>
              {places.data?.areas.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.locality} (W{a.ward})
                </option>
              ))}
            </Select>
            <Select aria-label="Importance" value={road.importance} onChange={(e) => setRoad({ ...road, importance: e.target.value })}>
              {[1, 2, 3, 4, 5].map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
            <Button onClick={() => addRoad.mutate()} disabled={!road.name || !road.areaId} loading={addRoad.isPending}>
              <Plus /> Add
            </Button>
          </div>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line text-[13px]">
            {places.data?.roads.map((r: any) => (
              <li key={r._id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {r.name} <span className="text-muted">· {r.area?.locality}</span>
                </span>
                <Select aria-label={`Importance of ${r.name}`} value={r.importance} className="h-8 w-16" onChange={(e) => updateRoad.mutate({ id: r._id, name: r.name, areaId: r.area?._id, importance: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Configuration" description="Only administrators can change these settings. Every change is versioned or written to the audit log." />
      <Tabs defaultValue="costs">
        <TabsList className="mb-6">
          <TabsTrigger value="costs">
            <Calculator /> Costs & severity
          </TabsTrigger>
          <TabsTrigger value="detection">
            <Cpu /> Detection & limits
          </TabsTrigger>
          <TabsTrigger value="priority">
            <Gauge /> Priority
          </TabsTrigger>
          <TabsTrigger value="cameras">
            <Camera /> Camera profiles
          </TabsTrigger>
          <TabsTrigger value="places">
            <MapPinned /> Roads & areas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="costs">
          <CostRates />
        </TabsContent>
        <TabsContent value="detection">
          <KeyValueSettings />
        </TabsContent>
        <TabsContent value="priority">
          <PriorityWeights />
        </TabsContent>
        <TabsContent value="cameras">
          <CameraProfiles />
        </TabsContent>
        <TabsContent value="places">
          <Places />
        </TabsContent>
      </Tabs>
    </>
  );
}
