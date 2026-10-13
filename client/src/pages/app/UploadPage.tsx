import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Crosshair, FileVideo, ImageIcon, Info, MapPin, Trash2, UploadCloud, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn, fmt } from '@/lib/format';
import type { CameraProfile, Upload } from '@/lib/types';
import { usePlaces } from '@/features/potholes/filters';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, Notice, PageHeader } from '@/components/ui/display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { JobStatusBadge, ProgressBar } from '@/components/domain';

const IMAGE_TYPES = ['image/jpeg', 'image/png'];

interface Meta {
  roadName: string;
  ward: string;
  locality: string;
  lat: string;
  lon: string;
  cameraProfileId: string;
  notes: string;
  capturedAt: string;
  gpxOffsetSec: string;
}

const EMPTY: Meta = { roadName: '', ward: '', locality: '', lat: '', lon: '', cameraProfileId: '', notes: '', capturedAt: '', gpxOffsetSec: '' };

function DropZone({ accept, multiple, onFiles, children }: { accept: string; multiple: boolean; onFiles: (f: File[]) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn('rounded-xl border-2 border-dashed bg-[#faf9f6] px-6 py-10 text-center transition-colors', over ? 'border-accent bg-accent-soft' : 'border-line-strong')}
    >
      <UploadCloud className="mx-auto size-8 text-muted" aria-hidden />
      <div className="mt-3 text-sm text-ink-2">{children}</div>
      <Button type="button" variant="secondary" className="mt-4" onClick={() => input.current?.click()}>
        Choose file{multiple ? 's' : ''}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        aria-label="Choose files to upload"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function CreatedItems({ ids }: { ids: string[] }) {
  const q = useQuery({
    queryKey: ['upload-batch', ids],
    queryFn: async () => Promise.all(ids.map(async (id) => (await api.get<{ upload: Upload; job: Upload['job'] }>(`/uploads/${id}`)).data)),
    refetchInterval: (query) => (query.state.data?.some((d) => d.upload.status === 'queued' || d.upload.status === 'processing') ? 2000 : false),
  });
  return (
    <Card>
      <CardHeader title="Processing" description="Detection runs in the background; you can leave this page." />
      <ul className="divide-y divide-line">
        {(q.data ?? []).map(({ upload, job }) => (
          <li key={upload._id} className="flex flex-wrap items-center gap-4 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-ink">{upload.originalName}</div>
              <div className="text-xs text-muted">
                {job?.stage ?? 'Queued'}
                {upload.error && <span className="text-danger"> · {upload.error}</span>}
              </div>
              {(upload.status === 'queued' || upload.status === 'processing') && <ProgressBar value={job?.progress ?? 2} className="mt-2 max-w-sm" />}
            </div>
            <JobStatusBadge status={upload.status} />
            {upload.status === 'completed' && (
              <span className="num text-xs text-muted">
                {upload.uniquePotholeCount} pothole(s){upload.kind === 'video' ? ` from ${upload.detectionCount} frame detections` : ''}
              </span>
            )}
            <Button size="sm" variant={upload.status === 'completed' ? 'primary' : 'secondary'} asChild>
              <Link to={`/app/uploads/${upload._id}`}>{upload.status === 'completed' ? 'View results' : 'Open'}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function UploadPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'images' | 'video'>('images');
  const [images, setImages] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [gpx, setGpx] = useState<File | null>(null);
  const [meta, setMeta] = useState<Meta>(EMPTY);
  const [progress, setProgress] = useState<number | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const places = usePlaces();
  const profiles = useQuery({ queryKey: ['camera-profiles'], queryFn: async () => (await api.get<{ items: CameraProfile[] }>('/camera-profiles')).data.items });
  const processing = useQuery({ queryKey: ['settings', 'processing'], queryFn: async () => (await api.get('/settings/processing')).data.value });
  const limits = processing.data ?? { maxImageMB: 15, maxVideoMB: 500, maxFilesPerUpload: 20, maxVideoDurationSec: 600, videoSampleFps: 5 };

  const set = (k: keyof Meta) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setMeta((m) => ({ ...m, [k]: e.target.value }));

  const addImages = useCallback(
    (files: File[]) => {
      const ok = files.filter((f) => IMAGE_TYPES.includes(f.type) && f.size <= limits.maxImageMB * 1024 * 1024);
      const rejected = files.length - ok.length;
      if (rejected) toast.error(`${rejected} file(s) skipped: only JPG/PNG up to ${limits.maxImageMB} MB`);
      setImages((cur) => [...cur, ...ok].slice(0, limits.maxFilesPerUpload));
    },
    [limits.maxImageMB, limits.maxFilesPerUpload],
  );

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error('This browser cannot provide a location');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMeta((m) => ({ ...m, lat: pos.coords.latitude.toFixed(6), lon: pos.coords.longitude.toFixed(6) }));
        toast.success(`Location set (±${Math.round(pos.coords.accuracy)} m). Use only if you are standing at the pothole.`);
      },
      (err) => toast.error(`Location unavailable: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submit = async () => {
    setError(null);
    const files = tab === 'images' ? images : video ? [video] : [];
    if (!files.length) return setError(tab === 'images' ? 'Add at least one JPG or PNG photograph.' : 'Choose an MP4 video.');
    if ((meta.lat && !meta.lon) || (!meta.lat && meta.lon)) return setError('Enter both latitude and longitude, or neither.');
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    if (tab === 'video' && gpx) form.append('gpx', gpx);
    for (const [k, v] of Object.entries(meta)) {
      if (!v) continue;
      if (tab === 'images' && (k === 'gpxOffsetSec' || k === 'capturedAt')) continue;
      form.append(k, k === 'capturedAt' ? new Date(v).toISOString() : v);
    }
    try {
      setProgress(0);
      const r = await api.post('/uploads', form, { onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : null), timeout: 0 });
      const ids = r.data.items.map((i: { id: string }) => i.id);
      setCreated(ids);
      setImages([]);
      setVideo(null);
      setGpx(null);
      toast.success(`${ids.length} file(s) uploaded — detection queued`);
      qc.invalidateQueries({ queryKey: ['uploads'] });
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'));
    } finally {
      setProgress(null);
    }
  };

  const wards = [...new Set(places.data?.areas.map((a) => a.ward) ?? [])].sort();
  const localities = [...new Set(places.data?.areas.map((a) => a.locality) ?? [])].sort();

  return (
    <>
      <PageHeader title="New upload" description="Upload road photographs or a recorded survey video. Detection uses the pretrained model; results appear on the upload page." />
      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardBody>
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'images' | 'video')}>
                <TabsList>
                  <TabsTrigger value="images">
                    <ImageIcon /> Photographs
                  </TabsTrigger>
                  <TabsTrigger value="video">
                    <FileVideo /> Survey video
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="images" className="mt-5 space-y-4">
                  <DropZone accept="image/jpeg,image/png" multiple onFiles={addImages}>
                    Drag photographs here — JPG or PNG, up to {limits.maxImageMB} MB each, {limits.maxFilesPerUpload} per upload.
                  </DropZone>
                  {images.length > 0 && (
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {images.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                          <ImageIcon className="size-4 text-muted" />
                          <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                          <span className="num text-muted">{fmt.bytes(f.size)}</span>
                          <Button variant="ghost" size="icon-sm" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                            <X />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
                <TabsContent value="video" className="mt-5 space-y-4">
                  {video ? (
                    <div className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-[13px]">
                      <FileVideo className="size-5 text-muted" />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{video.name}</span>
                      <span className="num text-muted">{fmt.bytes(video.size)}</span>
                      <Button variant="ghost" size="icon-sm" onClick={() => setVideo(null)} aria-label="Remove video">
                        <Trash2 />
                      </Button>
                    </div>
                  ) : (
                    <DropZone
                      accept="video/mp4"
                      multiple={false}
                      onFiles={(f) => {
                        const v = f.find((x) => x.type === 'video/mp4');
                        if (!v) return toast.error('Choose an MP4 video');
                        if (v.size > limits.maxVideoMB * 1024 * 1024) return toast.error(`Video exceeds ${limits.maxVideoMB} MB`);
                        setVideo(v);
                      }}
                    >
                      Drag an MP4 survey video here — up to {limits.maxVideoMB} MB and {Math.round(limits.maxVideoDurationSec / 60)} minutes. Frames are sampled at {limits.videoSampleFps} fps.
                    </DropZone>
                  )}
                  <Notice tone="info" icon={<Info />}>
                    Detections are tracked across frames so each pothole is stored once. GPS is assigned only from a GPX track; without one, video potholes have no map position.
                  </Notice>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="GPX track (optional)" className="sm:col-span-3">
                      {(p) => <Input {...p} type="file" accept=".gpx,application/gpx+xml" onChange={(e) => setGpx(e.target.files?.[0] ?? null)} />}
                    </Field>
                    <Field label="Recording start (local time)" hint="Defaults to the first GPX point" className="sm:col-span-2">
                      {(p) => <Input {...p} type="datetime-local" value={meta.capturedAt} onChange={set('capturedAt')} />}
                    </Field>
                    <Field label="GPX offset (s)" hint="Camera clock vs GPS">
                      {(p) => <Input {...p} type="number" step="0.5" value={meta.gpxOffsetSec} onChange={set('gpxOffsetSec')} />}
                    </Field>
                  </div>
                </TabsContent>
              </Tabs>
            </CardBody>
          </Card>
          {created.length > 0 && <CreatedItems ids={created} />}
        </div>

        <Card className="h-fit">
          <CardHeader title="Location & context" description="Applied to every file in this upload." />
          <CardBody className="space-y-4">
            <Field label="Road name">
              {(p) => (
                <>
                  <Input {...p} list="road-names" value={meta.roadName} onChange={set('roadName')} placeholder="e.g. Indapur–Baramati Road" />
                  <datalist id="road-names">
                    {places.data?.roads.map((r) => (
                      <option key={r._id} value={r.name} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ward">
                {(p) => (
                  <>
                    <Input {...p} list="ward-names" value={meta.ward} onChange={set('ward')} />
                    <datalist id="ward-names">
                      {wards.map((w) => (
                        <option key={w} value={w} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
              <Field label="Locality">
                {(p) => (
                  <>
                    <Input {...p} list="locality-names" value={meta.locality} onChange={set('locality')} />
                    <datalist id="locality-names">
                      {localities.map((l) => (
                        <option key={l} value={l} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </div>
            {tab === 'images' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitude" hint="Optional">
                    {(p) => <Input {...p} inputMode="decimal" value={meta.lat} onChange={set('lat')} placeholder="18.1167" />}
                  </Field>
                  <Field label="Longitude" hint="Optional">
                    {(p) => <Input {...p} inputMode="decimal" value={meta.lon} onChange={set('lon')} placeholder="75.0333" />}
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={useMyLocation}>
                    <Crosshair /> Use my current location
                  </Button>
                  <span className="text-xs text-muted">
                    <MapPin className="mr-1 inline size-3" />
                    If left empty, GPS is read from photo EXIF when present.
                  </span>
                </div>
              </div>
            )}
            <Field label="Camera profile" hint="Only for a surveyed fixed camera. Otherwise calibrate each image with a reference object.">
              {(p) => (
                <Select {...p} value={meta.cameraProfileId} onChange={set('cameraProfileId')}>
                  <option value="">None — calibrate per image</option>
                  {profiles.data
                    ?.filter((c) => c.active)
                    .map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} ({c.method === 'homography' ? 'homography' : 'fixed scale'})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Notes">{(p) => <Textarea {...p} rows={3} value={meta.notes} onChange={set('notes')} maxLength={2000} />}</Field>
            {error && <Notice tone="danger">{error}</Notice>}
            {progress !== null && (
              <div>
                <div className="num mb-1 text-xs text-muted">Uploading… {progress}%</div>
                <ProgressBar value={progress} />
              </div>
            )}
            <Button className="w-full" size="lg" onClick={submit} loading={progress !== null}>
              <UploadCloud /> Upload and detect
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
