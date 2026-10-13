import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, LifeBuoy, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/display';
import { DetectionShowcase, FeatureGrid, HowItWorksSteps, PageIntro, RoleCards, Section, TrustStrip } from './sections';
import detections from '@/assets/detections.json';

export function LandingPage() {
  const hero = detections.test_1;
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1 text-xs font-medium text-ink-2">
              <span className="size-1.5 rounded-full bg-accent" /> For municipal councils, PWD sub-divisions and road contractors
            </div>
            <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[46px]">
              Find potholes, measure them, and know what repairs will cost.
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted">
              RoadSight runs a pretrained pothole detector on road photographs and survey video, converts calibrated detections into length,
              width, depth and volume, and turns volume into a severity band and a repair estimate your engineers can check.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/register">
                  Request access <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="secondary" asChild>
                <Link to="/how-it-works">See how it works</Link>
              </Button>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-6 text-sm">
              <div>
                <dt className="text-muted">Detection threshold</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink">0.40</dd>
              </div>
              <div>
                <dt className="text-muted">Video sampling</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink">5 fps</dd>
              </div>
              <div>
                <dt className="text-muted">CPU inference</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink">≈{(hero.inferenceMs / 1000).toFixed(1)} s</dd>
              </div>
            </dl>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-xl border border-line bg-canvas shadow-[var(--shadow-pop)]">
              <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5 text-xs text-muted">
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="ml-2 font-medium text-ink-2">Detection result</span>
              </div>
              <img src="/images/test_1_annotated.jpg" alt="Road photograph with two potholes outlined by the detector at confidence 0.86 and 0.80" className="aspect-square w-full object-cover" />
              <div className="num grid grid-cols-3 divide-x divide-line border-t border-line bg-surface text-center text-xs">
                <div className="px-2 py-2.5">
                  <div className="text-muted">Detections</div>
                  <div className="mt-0.5 font-semibold text-ink">{hero.detections.length}</div>
                </div>
                <div className="px-2 py-2.5">
                  <div className="text-muted">Top confidence</div>
                  <div className="mt-0.5 font-semibold text-ink">{hero.detections[0].confidence.toFixed(2)}</div>
                </div>
                <div className="px-2 py-2.5">
                  <div className="text-muted">Size</div>
                  <div className="mt-0.5 font-semibold text-accent-strong">Not calibrated</div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">Real model output. Size stays “Not calibrated” until a reference object is marked.</p>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
        <TrustStrip />
      </div>
      <Section eyebrow="Capabilities" title="One record per pothole, from photograph to repair" intro="Detection, measurement, costing, review and reporting share a single database, so nothing is re-typed and every figure can be traced.">
        <FeatureGrid />
      </Section>
      <Section eyebrow="On real roads" title="What the detector actually returns" intro="These are unedited results from the pretrained model this application uses.">
        <DetectionShowcase />
      </Section>
      <Section eyebrow="Workflow" title="How a survey becomes a costed work order">
        <HowItWorksSteps />
      </Section>
      <Section eyebrow="Roles" title="Built for the three people who handle a pothole">
        <RoleCards />
      </Section>
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-xl bg-graphite-900 px-8 py-10 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Ready to survey your roads?</h2>
            <p className="mt-2 max-w-xl text-sm text-[#b8bdc4]">Accounts are approved by your administrator. Inspectors can start uploading as soon as they are approved.</p>
          </div>
          <Button variant="accent" size="lg" asChild>
            <Link to="/register">
              Request access <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}

export function ProductPage() {
  return (
    <>
      <PageIntro
        eyebrow="Product overview"
        title="A maintenance planning system built on measured damage, not lump sums"
        intro="Manual surveys size potholes by eye and price repairs per kilometre. RoadSight keeps a photograph, measurement, cost and status for each pothole, so budgets follow the damaged volume and repairs can be ranked."
      />
      <Section title="What the system records for every pothole">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ['Evidence', 'Original photograph or best video frame, annotated detection, crop, model version and confidence score.'],
            ['Measurement', 'Length, width and depth with their source (bounding box, segmentation mask, homography, model-scaled or manual) and the calibration used.'],
            ['Estimate', 'Volume, calculated and verified severity, material and labour cost, and the cost-configuration version that produced them.'],
            ['Workflow', 'Location and its source, verification decision, review history, repair status, work order and actual repair cost.'],
          ].map(([t, b]) => (
            <Card key={t} className="p-6">
              <h3 className="text-[15px] font-semibold text-ink">{t}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{b}</p>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Who uses it">
        <RoleCards />
      </Section>
      <Section title="Honest by design" intro="Public money follows these numbers, so the system fails visibly instead of guessing.">
        <TrustStrip />
      </Section>
    </>
  );
}

export function FeaturesPage() {
  return (
    <>
      <PageIntro eyebrow="Features" title="Everything between a road photograph and a repair report" intro="Each capability is part of the working application; nothing on this page is a mock-up." />
      <Section title="Capabilities">
        <FeatureGrid />
      </Section>
      <Section title="Detection examples">
        <DetectionShowcase />
      </Section>
    </>
  );
}

export function HowItWorksPage() {
  return (
    <>
      <PageIntro eyebrow="How it works" title="Six steps from survey to work order" intro="The processing pipeline follows the design in the project's preliminary report, with each step a separate, testable module." />
      <Section title="The pipeline">
        <HowItWorksSteps />
      </Section>
      <Section title="The formulas" intro="All values below are configurable by an administrator; the defaults are the report's prototype placeholders.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['Scale', 's = reference length ÷ pixel length', 'A4 long side 0.297 m over 180 px → 0.00165 m/px'],
            ['Volume', 'V = (π / 4) × L × W × D', '0.80 × 0.60 × 0.06 m → 0.0226 m³ (Moderate)'],
            ['Cost per visit', 'C = Σ V × (Cmat + Clab) + Cmob', '0.0226 × ₹31,000 + ₹500 → ₹1,201'],
          ].map(([t, f, e]) => (
            <Card key={t} className="p-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t}</div>
              <div className="mt-2 font-mono text-[15px] text-ink">{f}</div>
              <div className="mt-3 border-t border-line pt-3 text-[13px] text-muted">{e}</div>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}

export function MethodologyPage() {
  return (
    <>
      <PageIntro
        eyebrow="AI methodology"
        title="Pretrained models, explicit calibration, and stated limits"
        intro="This project does not train or fine-tune any model. It uses published checkpoints and documents exactly what they can and cannot tell you."
      />
      <Section title="Models in use">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <h3 className="text-[15px] font-semibold text-ink">Pothole detector</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              <span className="font-mono text-ink-2">DanielsStulpe/pothole-detection</span>, checkpoint <span className="font-mono text-ink-2">yolo26_best.pt</span>, pinned to commit
              <span className="font-mono text-ink-2"> 42b586f1</span>. Single class “pothole”, bounding boxes, MIT licence per its model card; runs with the Ultralytics library
              (AGPL-3.0). A segmentation alternative (<span className="font-mono text-ink-2">keremberke/yolov8n-pothole-segmentation</span>) can be selected by configuration.
            </p>
          </Card>
          <Card className="p-6">
            <h3 className="text-[15px] font-semibold text-ink">Depth model</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              <span className="font-mono text-ink-2">depth-anything/Depth-Anything-V2-Small-hf</span> (Apache-2.0). It produces relative inverse depth with no unit. The system samples the
              intact road around each box and the deepest 20% inside it, and converts that to metres only with a camera profile whose scale factor was fitted against hand
              measurements.
            </p>
          </Card>
        </div>
      </Section>
      <Section title="What confidence means">
        <Card className="p-6 text-[13.5px] leading-relaxed text-muted">
          A confidence score is the detector's own ranking of a box. It is not the probability that the road is damaged and says nothing about measurement accuracy.
          Detections between the 0.40 threshold and 0.60 are marked “Needs review”. Accuracy figures (precision, recall, mAP) are shown in the application only when an
          evaluation was actually run on labelled data.
        </Card>
      </Section>
      <Section title="Known limitations">
        <ul className="grid gap-3 md:grid-cols-2">
          {[
            'A reference-object scale is valid only near the object\'s plane and distance from the camera.',
            'Bounding-box dimensions overestimate irregular potholes; segmentation masks are used when the selected model provides them.',
            'Monocular depth is the least reliable measurement; manual depth entry is provided and recorded as such.',
            'Water-filled potholes, night images, heavy shadows and occlusion reduce detection quality.',
            'The elliptical-bowl volume is an approximation and slightly overestimates a true bowl.',
            'Costs are only as accurate as the material, labour and mobilisation rates configured.',
          ].map((t) => (
            <li key={t} className="rounded-lg border border-line bg-surface px-4 py-3 text-[13.5px] text-ink-2">
              {t}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export function HelpPublicPage() {
  return (
    <>
      <PageIntro eyebrow="Help & contact" title="Getting started and getting help" intro="Accounts are created by request and approved by your organisation's administrator." />
      <Section title="Common questions">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-6">
            <BookOpen className="size-5 text-accent-strong" />
            <h3 className="mt-3 text-[15px] font-semibold">I requested access — what next?</h3>
            <p className="mt-1.5 text-[13.5px] text-muted">An administrator reviews new registrations. You can sign in once your account is approved; you will see a notice until then.</p>
          </Card>
          <Card className="p-6">
            <LifeBuoy className="size-5 text-accent-strong" />
            <h3 className="mt-3 text-[15px] font-semibold">Why does my pothole say “Not calibrated”?</h3>
            <p className="mt-1.5 text-[13.5px] text-muted">Physical size needs a reference. Open the upload, choose “Calibrate”, click both ends of an object of known length and enter that length.</p>
          </Card>
          <Card className="p-6">
            <Mail className="size-5 text-accent-strong" />
            <h3 className="mt-3 text-[15px] font-semibold">Contact</h3>
            <p className="mt-1.5 text-[13.5px] text-muted">
              For account problems contact your organisation's RoadSight administrator. For deployment questions see the project README and the docs folder.
            </p>
          </Card>
        </div>
      </Section>
    </>
  );
}
