import type { ReactNode } from 'react';
import {
  BarChart3,
  Calculator,
  Camera,
  ClipboardCheck,
  FileText,
  Film,
  Gauge,
  Map as MapIcon,
  Ruler,
  ScanSearch,
  ShieldCheck,
  Users,
} from 'lucide-react';
import detections from '@/assets/detections.json';

export function Section({ eyebrow, title, intro, children, className = '' }: { eyebrow?: string; title: ReactNode; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mx-auto max-w-6xl px-4 py-16 sm:px-6 ${className}`}>
      <div className="mb-10 max-w-2xl">
        {eyebrow && <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-strong">{eyebrow}</div>}
        <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h2>
        {intro && <p className="mt-3 text-[15px] leading-relaxed text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function PageIntro({ eyebrow, title, intro }: { eyebrow: string; title: string; intro: ReactNode }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent-strong">{eyebrow}</div>
        <h1 className="max-w-3xl text-[34px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">{intro}</p>
      </div>
    </div>
  );
}

const FEATURES: Array<[ReactNode, string, string]> = [
  [<ScanSearch />, 'Pretrained pothole detector', 'A published, single-class pothole model from Hugging Face runs on every photograph and sampled video frame. Its real boxes and confidence scores are stored, never edited.'],
  [<Ruler />, 'Calibrated measurement', 'Click two ends of a reference object (an A4 sheet, a 30 cm ruler) or use a surveyed camera profile. Without calibration the system says “Not calibrated” instead of guessing a size.'],
  [<Calculator />, 'Volume, severity and cost', 'Elliptical-bowl volume, Minor / Moderate / Severe bands and C = V × (material + labour) + mobilisation, using rates your administrator sets and versions.'],
  [<Film />, 'Survey video with de-duplication', 'Frames are sampled at 5 fps and detections are tracked across frames, so each physical pothole is stored once with its best frame.'],
  [<MapIcon />, 'Map of real locations', 'Markers appear only where EXIF, a GPX track or an inspector supplied genuine coordinates. Road names are never turned into invented points.'],
  [<ClipboardCheck />, 'Engineer review', 'Low-confidence detections and implausible depths are flagged. Engineers verify, reject or correct measurements with a recorded reason.'],
  [<Gauge />, 'Transparent priority', 'A configurable score combines severity, verification, age, road importance and location quality — and lists the reason behind every point.'],
  [<BarChart3 />, 'Analytics and Power BI', 'Live dashboards and a normalised star-schema export with DAX measures. Mobilisation is counted once per repair visit, never per pothole.'],
  [<FileText />, 'Audit-ready reports', 'PDF and CSV maintenance reports carry the model version and the cost configuration used, so figures can be checked later.'],
];

export function FeatureGrid() {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map(([icon, title, body]) => (
        <div key={title} className="bg-surface p-6">
          <div className="mb-3 grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-strong [&_svg]:size-[18px]">{icon}</div>
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{body}</p>
        </div>
      ))}
    </div>
  );
}

const STEPS: Array<[string, string, string]> = [
  ['Capture', 'Field inspectors photograph the road with a phone or record a dash-camera survey. Optional: GPS, road, ward and locality.', 'Phone camera · dash camera · GPX'],
  ['Detect', 'The pretrained detector returns a box and confidence for each pothole (default threshold 0.40). Video detections are tracked so duplicates merge.', 'YOLO-family model · CPU or GPU'],
  ['Calibrate', 'Mark a reference object of known length, or select a surveyed camera profile. Length and width follow from the pixel-to-metre scale.', 'Reference object · homography'],
  ['Measure depth', 'A pretrained monocular model gives relative depth. It becomes metres only with a fitted camera profile; otherwise depth is measured and entered.', 'Depth Anything V2 · manual entry'],
  ['Estimate', 'Volume V = (π/4)·L·W·D sets the severity band and the cost C = V·(Cmat + Clab) + Cmob per repair visit.', 'Versioned rates · severity bands'],
  ['Review & plan', 'Engineers verify detections, group potholes into work orders, track repair status and export reports or Power BI data.', 'Work orders · reports · Power BI'],
];

export function HowItWorksSteps() {
  return (
    <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {STEPS.map(([title, body, meta], i) => (
        <li key={title} className="relative rounded-xl border border-line bg-surface p-6">
          <div className="num mb-4 flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-full bg-graphite-900 text-[13px] font-semibold text-white">{i + 1}</span>
            <span className="text-[15px] font-semibold text-ink">{title}</span>
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted">{body}</p>
          <div className="mt-4 border-t border-line pt-3 text-xs font-medium text-ink-2">{meta}</div>
        </li>
      ))}
    </ol>
  );
}

export function RoleCards() {
  const roles: Array<[ReactNode, string, string[]]> = [
    [<Camera />, 'Field Inspector', ['Upload photos, batches and survey video', 'Calibrate images with a reference object', 'Flag incorrect detections and submit for review']],
    [<ClipboardCheck />, 'Road Engineer', ['Verify or reject detections with reasons', 'Correct measurements and locations', 'Plan work orders, update repair status, export reports']],
    [<Users />, 'Administrator', ['Approve accounts and assign roles', 'Version cost rates, severity bands and thresholds', 'Monitor jobs, model status and the audit log']],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {roles.map(([icon, title, items]) => (
        <div key={title} className="rounded-xl border border-line bg-surface p-6">
          <div className="mb-3 flex items-center gap-2.5 text-ink [&_svg]:size-5 [&_svg]:text-accent-strong">
            {icon}
            <h3 className="text-[15px] font-semibold">{title}</h3>
          </div>
          <ul className="space-y-2 text-[13.5px] text-muted">
            {items.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-accent" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DetectionShowcase() {
  const items = ['test_1', 'validation_0', 'test_3'] as const;
  return (
    <figure>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((k) => (
          <div key={k} className="overflow-hidden rounded-lg border border-line bg-surface">
            <img src={`/images/${k}_annotated.jpg`} alt={`Road photograph with ${detections[k].detections.length} pothole detection(s) drawn by the model`} className="aspect-square w-full object-cover" loading="lazy" />
            <div className="num flex justify-between border-t border-line px-3 py-2 text-xs text-muted">
              <span>{detections[k].detections.length} detection(s)</span>
              <span>conf {detections[k].detections.map((d) => d.confidence.toFixed(2)).join(', ')}</span>
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 text-xs leading-relaxed text-muted">
        Actual output of <span className="font-mono">{detections.test_1.model}</span> on CPU (≈{Math.round(detections.test_1.inferenceMs)} ms per image), threshold 0.40.
        Photographs: Roboflow “pothole-detection-irkz9” test/validation split via keremberke/pothole-segmentation, CC BY 4.0.
      </figcaption>
    </figure>
  );
}

export function TrustStrip() {
  const points: Array<[ReactNode, string]> = [
    [<ShieldCheck />, 'No invented numbers: missing calibration, depth or GPS is shown as missing'],
    [<Calculator />, 'Mobilisation charged once per repair visit'],
    [<FileText />, 'Every estimate records its model and cost-configuration version'],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {points.map(([icon, text]) => (
        <div key={text} className="flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-accent-strong">
          {icon}
          {text}
        </div>
      ))}
    </div>
  );
}
