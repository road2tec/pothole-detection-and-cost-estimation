import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, Clock, FlaskConical, ImageOff, Ruler, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, label } from '@/lib/format';
import { Badge, Skeleton } from './ui/display';

/**
 * Images are protected API resources, so <img src> cannot carry the bearer token.
 * This fetches the file as a blob through the authorised client and renders an object URL.
 */
export function AuthedImage({ src, alt, className, fallbackClassName, ...props }: { src?: string | null; alt: string; fallbackClassName?: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    if (!src) {
      setState('error');
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    setState('loading');
    api
      .get(src, { responseType: 'blob' })
      .then((r) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(r.data as Blob);
        setUrl(objectUrl);
        setState('ok');
      })
      .catch(() => !revoked && setState('error'));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  if (state === 'loading') return <Skeleton className={cn('h-full min-h-24 w-full', fallbackClassName ?? className)} />;
  if (state === 'error' || !url)
    return (
      <div className={cn('grid min-h-24 place-items-center bg-subtle text-xs text-muted', fallbackClassName ?? className)}>
        <span className="flex items-center gap-1.5">
          <ImageOff className="size-4" /> Image unavailable
        </span>
      </div>
    );
  return <img src={url} alt={alt} className={className} {...props} />;
}

export function SeverityBadge({ severity, className }: { severity?: string | null; className?: string }) {
  if (!severity) return <Badge className={className}>Not classified</Badge>;
  const tone = severity === 'severe' ? 'severe' : severity === 'moderate' ? 'moderate' : 'minor';
  const dots = severity === 'severe' ? 3 : severity === 'moderate' ? 2 : 1;
  return (
    <Badge tone={tone} className={className}>
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className={cn('size-1.5 rounded-full', i < dots ? 'bg-current' : 'bg-current/25')} />
        ))}
      </span>
      {label('severity', severity)}
    </Badge>
  );
}

export function RepairBadge({ status }: { status: string }) {
  const tone = status === 'repaired' ? 'ok' : status === 'scheduled' || status === 'in_progress' ? 'info' : status === 'deferred' ? 'neutral' : 'warn';
  return <Badge tone={tone}>{label('repair', status)}</Badge>;
}

export function VerificationBadge({ status }: { status: string }) {
  const map = {
    verified: { tone: 'ok', icon: <CheckCircle2 /> },
    rejected: { tone: 'danger', icon: <XCircle /> },
    pending_review: { tone: 'accent', icon: <Clock /> },
    unsubmitted: { tone: 'neutral', icon: <CircleDashed /> },
  } as const;
  const m = map[status as keyof typeof map] ?? map.unsubmitted;
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {label('verification', status)}
    </Badge>
  );
}

export function MeasurementBadge({ status }: { status: string }) {
  const tone = status === 'complete' ? 'ok' : status === 'invalid' ? 'danger' : 'neutral';
  return (
    <Badge tone={tone} icon={status === 'complete' ? <Ruler /> : <AlertCircle />}>
      {label('measurement', status)}
    </Badge>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="dark" icon={<FlaskConical />}>
      Demo data
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: string }) {
  const tone = status === 'completed' ? 'ok' : status === 'failed' ? 'danger' : status === 'running' || status === 'processing' ? 'info' : 'neutral';
  return <Badge tone={tone}>{label('jobStatus', status)}</Badge>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-subtle', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2" title="Model confidence score (not measurement accuracy)">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <span className="block h-full rounded-full bg-graphite-700" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="num text-ink">{value.toFixed(2)}</span>
    </span>
  );
}
