import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/form';

export const FILTER_KEYS = [
  'q',
  'ward',
  'locality',
  'road',
  'severity',
  'verificationStatus',
  'repairStatus',
  'measurementStatus',
  'needsReview',
  'minConfidence',
  'from',
  'to',
  'dataset',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

/** Filter state stored in the URL so filtered views can be bookmarked and shared. */
export function useFilters(defaults: Filters = {}) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => {
    const f: Filters = { ...defaults };
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v !== null) f[k] = v;
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);
  const page = Number(params.get('page') ?? 1) || 1;
  const set = (patch: Filters & { page?: number }) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const reset = () => setParams(new URLSearchParams(), { replace: true });
  return { filters, page, set, reset };
}

export function usePlaces() {
  return useQuery({
    queryKey: ['places'],
    queryFn: async () => {
      const [areas, roads] = await Promise.all([api.get('/places/areas'), api.get('/places/roads')]);
      return { areas: areas.data.items as Array<{ _id: string; ward: string; locality: string; city?: string }>, roads: roads.data.items as Array<{ _id: string; name: string; importance: number; area?: { ward: string; locality: string } }> };
    },
    staleTime: 60_000,
  });
}

export function FilterBar({
  filters,
  set,
  reset,
  show = ['q', 'ward', 'locality', 'road', 'severity', 'verificationStatus', 'repairStatus', 'from', 'to', 'minConfidence', 'measurementStatus', 'dataset'],
  allowDemo = true,
}: {
  filters: Filters;
  set: (p: Filters) => void;
  reset: () => void;
  show?: FilterKey[];
  allowDemo?: boolean;
}) {
  const places = usePlaces();
  const [more, setMore] = useState(false);
  const wards = [...new Set(places.data?.areas.map((a) => a.ward) ?? [])].sort();
  const localities = [...new Set(places.data?.areas.filter((a) => !filters.ward || a.ward === filters.ward).map((a) => a.locality) ?? [])].sort();
  const roads = places.data?.roads ?? [];
  const has = (k: FilterKey) => show.includes(k);
  const primary: FilterKey[] = ['q', 'ward', 'locality', 'severity', 'repairStatus'];
  const secondaryShown = show.filter((k) => !primary.includes(k));
  const activeCount = FILTER_KEYS.filter((k) => filters[k] && k !== 'dataset').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {has('q') && (
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="f-q" className="sr-only">
              Search
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <Input id="f-q" placeholder="Search code, road, locality…" className="pl-9" defaultValue={filters.q ?? ''} onKeyDown={(e) => e.key === 'Enter' && set({ q: (e.target as HTMLInputElement).value })} onBlur={(e) => e.target.value !== (filters.q ?? '') && set({ q: e.target.value })} />
            </div>
          </div>
        )}
        {has('ward') && (
          <FilterSelect id="f-ward" label="Ward" value={filters.ward} onChange={(v) => set({ ward: v, locality: undefined })} options={wards.map((w) => [w, w])} />
        )}
        {has('locality') && <FilterSelect id="f-loc" label="Locality" value={filters.locality} onChange={(v) => set({ locality: v })} options={localities.map((l) => [l, l])} />}
        {has('severity') && (
          <FilterSelect
            id="f-sev"
            label="Severity"
            value={filters.severity}
            onChange={(v) => set({ severity: v })}
            options={[
              ['severe', 'Severe'],
              ['moderate', 'Moderate'],
              ['minor', 'Minor'],
              ['unclassified', 'Not classified'],
            ]}
          />
        )}
        {has('repairStatus') && (
          <FilterSelect
            id="f-rep"
            label="Repair status"
            value={filters.repairStatus}
            onChange={(v) => set({ repairStatus: v })}
            options={[
              ['reported', 'Reported'],
              ['scheduled', 'Scheduled'],
              ['in_progress', 'In progress'],
              ['repaired', 'Repaired'],
              ['deferred', 'Deferred'],
            ]}
          />
        )}
        {secondaryShown.length > 0 && (
          <Button variant="secondary" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <SlidersHorizontal /> More filters
          </Button>
        )}
        {activeCount > 0 && (
          <Button variant="ghost" onClick={reset}>
            <RotateCcw /> Clear ({activeCount})
          </Button>
        )}
      </div>
      {more && (
        <div className="grid gap-3 rounded-lg border border-line bg-[#faf9f6] p-3 sm:grid-cols-2 lg:grid-cols-4">
          {has('road') && (
            <div className="space-y-1">
              <Label htmlFor="f-road">Road</Label>
              <Input id="f-road" list="f-road-list" defaultValue={filters.road ?? ''} onBlur={(e) => e.target.value !== (filters.road ?? '') && set({ road: e.target.value })} placeholder="Any road" />
              <datalist id="f-road-list">
                {roads.map((r) => (
                  <option key={r._id} value={r.name} />
                ))}
              </datalist>
            </div>
          )}
          {has('verificationStatus') && (
            <FilterSelect
              id="f-ver"
              label="Verification"
              value={filters.verificationStatus}
              onChange={(v) => set({ verificationStatus: v })}
              options={[
                ['unsubmitted', 'Not submitted'],
                ['pending_review', 'Pending review'],
                ['verified', 'Verified'],
                ['rejected', 'Rejected'],
              ]}
            />
          )}
          {has('measurementStatus') && (
            <FilterSelect
              id="f-meas"
              label="Measurement"
              value={filters.measurementStatus}
              onChange={(v) => set({ measurementStatus: v })}
              options={[
                ['complete', 'Measured'],
                ['depth_unavailable', 'Depth unavailable'],
                ['not_calibrated', 'Not calibrated'],
              ]}
            />
          )}
          {has('minConfidence') && (
            <FilterSelect
              id="f-conf"
              label="Min. confidence"
              value={filters.minConfidence}
              onChange={(v) => set({ minConfidence: v })}
              options={[
                ['0.5', '≥ 0.50'],
                ['0.6', '≥ 0.60'],
                ['0.7', '≥ 0.70'],
                ['0.8', '≥ 0.80'],
              ]}
            />
          )}
          {has('from') && (
            <div className="space-y-1">
              <Label htmlFor="f-from">Detected from</Label>
              <Input id="f-from" type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value })} />
            </div>
          )}
          {has('to') && (
            <div className="space-y-1">
              <Label htmlFor="f-to">Detected to</Label>
              <Input id="f-to" type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
            </div>
          )}
          {has('dataset') && allowDemo && (
            <FilterSelect
              id="f-ds"
              label="Dataset"
              value={filters.dataset}
              placeholder="Live records only"
              onChange={(v) => set({ dataset: v })}
              options={[
                ['all', 'Live + demo'],
                ['demo', 'Demo only'],
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ id, label, value, onChange, options, placeholder }: { id: string; label: string; value?: string; onChange: (v: string | undefined) => void; options: Array<[string, string]>; placeholder?: string }) {
  return (
    <div className="min-w-[150px] space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{placeholder ?? `All`}</option>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </Select>
    </div>
  );
}
