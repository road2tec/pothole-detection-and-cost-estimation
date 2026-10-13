import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en-IN');

export const fmt = {
  inr: (v?: number | null) => (v === null || v === undefined ? '—' : inr.format(v)),
  inrCompact: (v?: number | null) => (v === null || v === undefined ? '—' : inrCompact.format(v)),
  int: (v?: number | null) => (v === null || v === undefined ? '—' : int.format(v)),
  pct: (v?: number | null, digits = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`),
  m: (v?: number | null, digits = 2) => (v === null || v === undefined ? '—' : `${v.toFixed(digits)} m`),
  m3: (v?: number | null) => (v === null || v === undefined ? '—' : `${v < 0.001 ? (v * 1e6).toFixed(0) + ' cm³' : v.toFixed(4) + ' m³'}`),
  conf: (v?: number | null) => (v === null || v === undefined ? '—' : v.toFixed(2)),
  date: (v?: string | Date | null) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'),
  dateTime: (v?: string | Date | null) =>
    v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
  relative: (v?: string | Date | null) => {
    if (!v) return '—';
    const s = (Date.now() - new Date(v).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return fmt.date(v);
  },
  bytes: (v?: number | null) => {
    if (!v) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = v;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  },
};

export const LABELS = {
  severity: { minor: 'Minor', moderate: 'Moderate', severe: 'Severe', unclassified: 'Not classified' } as Record<string, string>,
  repair: { reported: 'Reported', scheduled: 'Scheduled', in_progress: 'In progress', repaired: 'Repaired', deferred: 'Deferred' } as Record<string, string>,
  verification: { unsubmitted: 'Not submitted', pending_review: 'Pending review', verified: 'Verified', rejected: 'Rejected' } as Record<string, string>,
  measurement: {
    not_calibrated: 'Not calibrated',
    depth_unavailable: 'Depth unavailable',
    complete: 'Measured',
    invalid: 'Invalid input',
  } as Record<string, string>,
  role: { admin: 'Administrator', engineer: 'Road Engineer', inspector: 'Field Inspector' } as Record<string, string>,
  dimensionSource: { bbox: 'Bounding box × scale', mask: 'Segmentation mask × scale', homography: 'Homography (road plane)', manual: 'Entered manually' } as Record<string, string>,
  depthSource: { 'model-scaled': 'Monocular model, scaled', manual: 'Measured manually' } as Record<string, string>,
  jobStatus: { queued: 'Queued', running: 'Running', processing: 'Processing', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' } as Record<string, string>,
};

export const label = (group: keyof typeof LABELS, key?: string | null) => (key ? LABELS[group][key] ?? key : '—');
