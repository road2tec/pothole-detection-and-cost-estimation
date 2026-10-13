import type { HTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/format';
import { Button } from './button';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'minor' | 'moderate' | 'severe' | 'dark';
const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink-2 border-line',
  ok: 'bg-ok-soft text-ok border-[#bfe3ca]',
  warn: 'bg-warn-soft text-warn border-accent-line',
  danger: 'bg-danger-soft text-danger border-[#f4c7c2]',
  info: 'bg-info-soft text-info border-[#c8d6f8]',
  accent: 'bg-accent-soft text-accent-strong border-accent-line',
  minor: 'bg-sev-minor-soft text-sev-minor border-[#d3e5b5]',
  moderate: 'bg-sev-moderate-soft text-sev-moderate border-accent-line',
  severe: 'bg-sev-severe-soft text-sev-severe border-[#f2c5c0]',
  dark: 'bg-graphite-800 text-white border-graphite-700',
};

export function Badge({ tone = 'neutral', className, children, icon }: { tone?: Tone; className?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-subtle', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3 p-5" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-subtle text-muted [&_svg]:size-5">{icon ?? <Inbox />}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)} role="alert">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="text-sm font-semibold text-ink">Could not load this data</h3>
      <p className="mt-1 max-w-md text-[13px] text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, icon, className }: { tone?: 'info' | 'warn' | 'danger' | 'ok' | 'neutral'; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  const styles = {
    info: 'border-[#c8d6f8] bg-info-soft text-[#1e3a8a]',
    warn: 'border-accent-line bg-accent-soft text-[#7c3a0a]',
    danger: 'border-[#f4c7c2] bg-danger-soft text-[#7a1a12]',
    ok: 'border-[#bfe3ca] bg-ok-soft text-[#14532d]',
    neutral: 'border-line bg-subtle text-ink-2',
  }[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border px-4 py-3 text-[13px] leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', styles, className)}>
      {icon}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted" aria-label="Pagination">
      <span className="num">
        Page {page} of {pages} · {total.toLocaleString('en-IN')} records
      </span>
      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft /> Prev
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

export function Stat({ label, value, hint, icon, tone = 'neutral', className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'ok'; className?: string }) {
  const iconTone = { neutral: 'bg-subtle text-ink-2', accent: 'bg-accent-soft text-accent-strong', danger: 'bg-danger-soft text-danger', ok: 'bg-ok-soft text-ok' }[tone];
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-muted">{label}</div>
          <div className="num mt-1.5 truncate text-[22px] font-semibold tracking-tight text-ink">{value}</div>
        </div>
        {icon && <div className={cn('grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4', iconTone)}>{icon}</div>}
      </div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function DefinitionList({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  return (
    <dl className={cn('divide-y divide-line text-[13px]', className)}>
      {items.map(([k, val], i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2">
          <dt className="text-muted">{k}</dt>
          <dd className="num text-right font-medium text-ink">{val}</dd>
        </div>
      ))}
    </dl>
  );
}
