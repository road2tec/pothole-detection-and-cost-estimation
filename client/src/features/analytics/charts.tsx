import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmt } from '@/lib/format';
import { EmptyState } from '@/components/ui/display';

export const SEV_COLORS: Record<string, string> = { minor: '#65a30d', moderate: '#d97706', severe: '#b42318', unclassified: '#a8a29e' };
export const SERIES = ['#1c1f23', '#d97706', '#15803d', '#2563eb', '#a8a29e'];

const axis = { fontSize: 12, fill: '#6b7178' };
const grid = <CartesianGrid stroke="#ebe9e3" vertical={false} />;

function TooltipBox({ active, payload, label, money, unit }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; money?: boolean; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      {label && <div className="mb-1 font-medium text-ink">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="num flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-medium text-ink">{money ? fmt.inr(p.value) : `${fmt.int(p.value)}${unit ?? ''}`}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartFrame({ height = 260, empty, children, description }: { height?: number; empty?: boolean; children: ReactNode; description: string }) {
  if (empty) return <EmptyState title="No data for these filters" description="Records will appear here once matching potholes exist." className="py-10" />;
  return (
    <figure aria-label={description} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    </figure>
  );
}

export function SeverityDonut({ data }: { data: Array<{ severity: string; count: number }> }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  const labelled = data.filter((d) => d.count > 0).map((d) => ({ ...d, name: d.severity === 'unclassified' ? 'Not classified' : d.severity[0].toUpperCase() + d.severity.slice(1) }));
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
      <ChartFrame height={220} empty={total === 0} description="Donut chart of potholes by severity">
        <PieChart>
          <Pie data={labelled} dataKey="count" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={1.5} stroke="none">
            {labelled.map((d) => (
              <Cell key={d.severity} fill={SEV_COLORS[d.severity]} />
            ))}
          </Pie>
          <Tooltip content={<TooltipBox />} />
          <text x="50%" y="47%" textAnchor="middle" className="num" style={{ fontSize: 22, fontWeight: 600, fill: '#1c1f23' }}>
            {total}
          </text>
          <text x="50%" y="58%" textAnchor="middle" style={{ fontSize: 11, fill: '#6b7178' }}>
            potholes
          </text>
        </PieChart>
      </ChartFrame>
      {total > 0 && (
        <ul className="space-y-2 text-[13px]">
          {data.map((d) => (
            <li key={d.severity} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-2 text-ink-2">
                <span className="size-2.5 rounded-sm" style={{ background: SEV_COLORS[d.severity] }} />
                {d.severity === 'unclassified' ? 'Not classified' : d.severity[0].toUpperCase() + d.severity.slice(1)}
              </span>
              <span className="num font-medium text-ink">
                {d.count} <span className="text-muted">({total ? Math.round((d.count / total) * 100) : 0}%)</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TrendChart({ data }: { data: Array<{ period: string; detected: number; verified: number; repaired: number }> }) {
  return (
    <ChartFrame empty={data.length === 0} description="Line chart of detected, verified and repaired potholes over time">
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        {grid}
        <XAxis dataKey="period" tick={axis} tickLine={false} axisLine={{ stroke: '#e2e0d9' }} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip content={<TooltipBox />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        <Line type="monotone" dataKey="detected" name="Detected (unique)" stroke={SERIES[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="verified" name="Verified" stroke={SERIES[1]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="repaired" name="Repaired" stroke={SERIES[2]} strokeWidth={2} dot={false} />
      </LineChart>
    </ChartFrame>
  );
}

export function StackedSeverityBar({ data, nameKey = 'locality', height = 280 }: { data: Array<Record<string, number | string>>; nameKey?: string; height?: number }) {
  return (
    <ChartFrame height={height} empty={data.length === 0} description="Stacked bar chart of severity by area">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#ebe9e3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={nameKey} tick={axis} tickLine={false} axisLine={false} width={120} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: '#f3f2ee' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="severe" name="Severe" stackId="s" fill={SEV_COLORS.severe} />
        <Bar dataKey="moderate" name="Moderate" stackId="s" fill={SEV_COLORS.moderate} />
        <Bar dataKey="minor" name="Minor" stackId="s" fill={SEV_COLORS.minor} />
        <Bar dataKey="unclassified" name="Not classified" stackId="s" fill={SEV_COLORS.unclassified} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

export function MoneyBar({ data, height = 280, keys }: { data: Array<Record<string, number | string>>; height?: number; keys: Array<[string, string, string]> }) {
  return (
    <ChartFrame height={height} empty={data.length === 0} description="Bar chart of estimated repair budget">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: '#e2e0d9' }} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 60 : 30} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => fmt.inrCompact(v)} width={70} />
        <Tooltip content={<TooltipBox money />} cursor={{ fill: '#f3f2ee' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map(([k, n, c], i) => (
          <Bar key={k} dataKey={k} name={n} stackId="m" fill={c} radius={i === keys.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function SimpleBar({ data, dataKey, nameKey, color = SERIES[0], height = 220, unit }: { data: Array<Record<string, number | string>>; dataKey: string; nameKey: string; color?: string; height?: number; unit?: string }) {
  return (
    <ChartFrame height={height} empty={data.length === 0 || data.every((d) => !d[dataKey])} description={`Bar chart of ${dataKey}`}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        {grid}
        <XAxis dataKey={nameKey} tick={axis} tickLine={false} axisLine={{ stroke: '#e2e0d9' }} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip content={<TooltipBox unit={unit} />} cursor={{ fill: '#f3f2ee' }} />
        <Bar dataKey={dataKey} name="Potholes" fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}
