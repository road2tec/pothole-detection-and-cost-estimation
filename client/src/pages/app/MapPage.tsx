import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css';
import L from 'leaflet';
import { Info, MapPinOff } from 'lucide-react';
import { api, errorMessage, toParams } from '@/lib/api';
import { fmt, label } from '@/lib/format';
import type { Pothole } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { FilterBar, useFilters } from '@/features/potholes/filters';
import { clusterIcon, severityIcon } from '@/features/map/markers';
import { Card, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';

type Point = Pick<Pothole, '_id' | 'code' | 'location' | 'severity' | 'repairStatus' | 'verificationStatus' | 'roadName' | 'locality' | 'ward' | 'confidence' | 'volumeM3' | 'variableCost' | 'measurementStatus' | 'locationSource' | 'locationVerified' | 'isDemo'>;

const INDIA_CENTRE: [number, number] = [18.52, 73.86];

function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.location!.coordinates[1], p.location!.coordinates[0]] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

export default function MapPage() {
  const { user } = useAuth();
  const { filters, set, reset } = useFilters();
  const q = useQuery({
    queryKey: ['potholes', 'map', filters],
    queryFn: async () => (await api.get<{ items: Point[]; withoutLocation: number; truncated: boolean }>('/potholes/map', { params: toParams(filters) })).data,
  });
  const points = useMemo(() => q.data?.items ?? [], [q.data]);

  return (
    <>
      <PageHeader title="Map" description="Only potholes with genuine coordinates (photo EXIF, GPX track, entered or corrected by staff) are plotted. Road names are never converted into guessed positions." />
      <Card className="mb-4 px-5 py-4">
        <FilterBar filters={filters} set={set} reset={reset} allowDemo={user!.role !== 'inspector'} show={['q', 'ward', 'locality', 'road', 'severity', 'repairStatus', 'verificationStatus', 'from', 'to', 'dataset']} />
      </Card>
      {q.data && q.data.withoutLocation > 0 && (
        <Notice tone="info" icon={<MapPinOff />} className="mb-4">
          {fmt.int(q.data.withoutLocation)} matching pothole(s) have no recorded location and are not shown. Find them in the{' '}
          <Link to={`/app/potholes?${new URLSearchParams(toParams(filters)).toString()}`} className="font-medium underline">
            pothole list
          </Link>
          .
        </Notice>
      )}
      {q.data?.truncated && <Notice tone="warn" className="mb-4">Showing the first 10,000 points. Narrow the filters to see the rest.</Notice>}
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <LoadingBlock rows={8} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <div className="relative h-[calc(100vh-320px)] min-h-[420px]">
            <MapContainer center={INDIA_CENTRE} zoom={points.length ? 12 : 6} className="h-full w-full" scrollWheelZoom>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors" />
              <FitBounds points={points} />
              <MarkerClusterGroup chunkedLoading iconCreateFunction={clusterIcon} showCoverageOnHover={false} maxClusterRadius={50}>
                {points.map((p) => (
                  <Marker key={p._id} position={[p.location!.coordinates[1], p.location!.coordinates[0]]} icon={severityIcon(p.severity, p.repairStatus === 'repaired')} title={`${p.code} — ${label('severity', p.severity ?? 'unclassified')}`}>
                    <Popup minWidth={240}>
                      <div className="space-y-1.5 text-[13px]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-ink">{p.code}</span>
                          <span className="text-xs font-medium text-muted">{label('severity', p.severity ?? 'unclassified')}</span>
                        </div>
                        <div className="text-muted">{[p.roadName, p.locality, p.ward && `Ward ${p.ward}`].filter(Boolean).join(' · ') || 'No road recorded'}</div>
                        <div className="num grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1 text-xs">
                          <span className="text-muted">Confidence</span>
                          <span className="text-right">{fmt.conf(p.confidence)}</span>
                          <span className="text-muted">Volume</span>
                          <span className="text-right">{p.volumeM3 != null ? fmt.m3(p.volumeM3) : label('measurement', p.measurementStatus)}</span>
                          <span className="text-muted">Material + labour</span>
                          <span className="text-right">{fmt.inr(p.variableCost)}</span>
                          <span className="text-muted">Status</span>
                          <span className="text-right">{label('repair', p.repairStatus)}</span>
                          <span className="text-muted">Location</span>
                          <span className="text-right">
                            {p.locationSource}
                            {p.locationVerified ? ' ✓' : ''}
                          </span>
                        </div>
                        {p.isDemo && <div className="text-xs font-medium text-ink-2">Demo record</div>}
                        <Link to={`/app/potholes/${p._id}`} className="inline-block pt-1 font-medium text-accent-strong underline">
                          Open record
                        </Link>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MarkerClusterGroup>
            </MapContainer>
            {points.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-[400] grid place-items-center">
                <div className="rounded-lg border border-line bg-surface/95 px-5 py-4 text-center text-[13px] shadow-[var(--shadow-pop)]">
                  <div className="font-medium text-ink">No located potholes for these filters</div>
                  <div className="mt-1 text-muted">Records appear here once they carry real coordinates.</div>
                </div>
              </div>
            )}
            <div className="absolute bottom-4 left-4 z-[400] rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-sm">
              <div className="mb-1 flex items-center gap-1 font-medium text-ink">
                <Info className="size-3" /> Legend
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-ink-2">
                <span>S = Severe</span>
                <span>M = Moderate</span>
                <span>m = Minor</span>
                <span>? = Not classified</span>
                <span>✓ = Repaired</span>
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
