# Volume, severity, cost and priority

Implementation: `server/src/services/costing.ts` (pure, unit-tested), applied by `potholeEstimates.ts`.

## Volume (elliptical bowl, report Eq. 4.7)

```
V = (π / 4) × L × W × D        [m³, rounded to 6 decimals]
```

Missing L, W or D → volume is `null` (unknown), never 0. Non-finite, zero, negative or absurd values raise an error.

## Severity (report Eq. 4.10, Table 4.1 defaults)

| Band | Rule | Default |
|---|---|---|
| Minor | V < V₁ | V₁ = 0.005 m³ |
| Moderate | V₁ ≤ V < V₂ | |
| Severe | V ≥ V₂ | V₂ = 0.030 m³ |

`calculatedSeverity` is never overwritten. A reviewer may set `verifiedSeverity` (with a reason when it differs);
the effective `severity` is the verified value if present, else the calculated one.

## Cost (report Eq. 4.8 / 4.9)

```
Per pothole (stored):   material = V × Cmat,   labour = V × Clab,   variable = material + labour
Single-visit estimate:  C = V × (Cmat + Clab) + Cmob                 (shown on the pothole page)
Repair visit:           C = Σ Vⱼ × (Cmat + Clab) + Cmob              (mobilisation ONCE per visit)
```

Prototype defaults (report Table 4.1, placeholders flagged in the UI): Cmat ₹25,000/m³, Clab ₹6,000/m³,
Cmob ₹500/visit. Money is rounded to paise with decimal (not binary) rounding.

Worked example (report Table 4.2): L 0.80 m, W 0.60 m, D 0.06 m → V = 0.0226 m³ → Moderate →
C = 0.0226 × 31,000 + 500 = ₹1,201. This exact case is a unit test.

### Budget aggregation — no double-counted mobilisation

Used identically by the dashboard, reports and the Power BI export (`server/src/analytics/service.ts`):

1. Only **measured** potholes contribute; unmeasured ones are counted separately (their cost is unknown).
2. Potholes in a **repair visit** (work order) belong to that visit and use its mobilisation charge.
3. Unscheduled measured potholes form **provisional visits**, one per road (or ward + locality + road name if no road
   record exists), charged at the active mobilisation rate.
4. Estimated budget = Σ material + Σ labour + Σ mobilisation over the visits present in the filtered scope.
   A visit's mobilisation is counted once if any of its measured potholes is in scope.
5. By severity, only variable cost is shown: mobilisation belongs to visits, not severities.
6. In monthly trends a visit's mobilisation is attributed to the first month in which it appears.

Integration tests verify that three potholes on two roads cost two mobilisations, and one combined visit costs one.

### Configuration versioning

Rates and severity bands are a single versioned `CostConfiguration`. Saving creates version *n+1* and deactivates
the previous one. Each pothole stores `costConfigVersion`; changing rates does not silently rewrite existing
estimates. An administrator can “Recalculate open potholes”, which re-estimates unrepaired records and open work
orders. Completed and cancelled work orders keep their frozen estimate. Reports store a snapshot of the configuration.

### Actual cost and variance

* Actual expenditure = actual cost of work orders in scope + actual cost recorded on potholes outside any order.
* “Budget vs actual” compares a work order's estimate with its actual cost.
* “Budget variance” = approved budget target (optional admin setting) − total estimated budget; blank when no target exists.

## Repair priority

Configurable points (Configuration → Priority), defaults:

| Factor | Points |
|---|---|
| Severity: severe / moderate / minor / not yet measurable | 50 / 30 / 12 / 20 |
| Verified by engineer / submitted and awaiting review | +10 / +4 |
| Age since detection | up to +20, reached after 30 days |
| Road importance 1–5 (set by administrators) | 0 to +15 |
| Exact GPS location recorded | +5 |
| Deferred | score × 0.5 |
| Repaired or rejected | 0 |

Every record shows the reasons that produced its score. No traffic, accident or risk data is used, because the
system does not record any. Scores refresh on every change and every 30 minutes for the age component.
