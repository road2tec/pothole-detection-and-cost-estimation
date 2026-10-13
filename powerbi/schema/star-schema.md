# Power BI star schema

Two fact tables share conformed dimensions. **There is no relationship between the two fact tables**:
mobilisation is brought into pothole-level visuals by a DAX measure (see `../measures/measures.dax`),
which is what prevents budget totals being inflated by a one-to-many join.

```
                 DimDate ─────────────┐
                    │ (active: DateKey; inactive: VerifiedDateKey, RepairedDateKey)
DimSeverity ── FactPothole ── DimRoad          FactRepairVisit ── DimDate (visit date)
DimStatus   ──    │       ── DimArea                 │        ── DimRoad
DimModelVersion ──┘                                   └──────── DimArea
```

## FactPothole — one row per unique pothole (grain: pothole)

Rejected detections are excluded, matching the application's default scope.

| Column | Type | Meaning |
|---|---|---|
| PotholeKey | text | Pothole code, e.g. `PH-000123` (unique) |
| DateKey | int (yyyymmdd) | Detection date |
| RoadKey / AreaKey | text | Foreign keys to DimRoad / DimArea (`ROAD-UNKNOWN`, `AREA-UNKNOWN` when not recorded) |
| SeverityKey | int | 0 Not classified, 1 Minor, 2 Moderate, 3 Severe (effective severity: verified override, else calculated) |
| StatusKey | int | Repair status (DimStatus) |
| VerificationStatus | text | `unsubmitted`, `pending_review`, `verified` |
| Confidence | decimal | Model confidence score (not accuracy) |
| LengthM, WidthM, DepthM, VolumeM3 | decimal, nullable | Blank when not measured — never zero |
| MaterialCost, LabourCost | decimal, nullable | Per pothole, at the cost-configuration version it was estimated with |
| **EstimatedCost** | decimal, nullable | **Material + labour only. Excludes mobilisation.** |
| ActualCost | decimal, nullable | Actual repair cost recorded on the pothole |
| IsCalibrated / IsMeasured / IsVerified / IsUnique | boolean | IsUnique is always true at this grain |
| FrameDetections | int | Model observations behind this pothole (1 for images; tracked frames for video) |
| RepairVisitKey | text, nullable | Cost-bearing visit: real work-order code or provisional `PV-…` group. Blank for unmeasured potholes |
| AssignedVisitCode | text, nullable | Work order the pothole is assigned to (informational) |
| ModelVersion | text | FK to DimModelVersion |
| SourceType, DimensionSource, DepthSource, CostConfigVersion | text/int | Provenance |
| Latitude, Longitude | decimal, nullable | Only genuine coordinates |
| PriorityScore | decimal | Application priority score at export time |
| IsDemo | boolean | True only for seeded demo records (excluded unless the export included demo data) |
| VerifiedDateKey, RepairedDateKey | int, nullable | Review / repair dates for trend visuals |

## FactRepairVisit — one row per repair visit (grain: visit)

Real work orders plus **provisional visits**: unscheduled measured potholes are grouped one visit per road
(or per ward + locality + road name when no road record exists), exactly as the application budgets them.

| Column | Meaning |
|---|---|
| RepairVisitKey | Work-order code (`WO-…`) or provisional key (`PV-…`) |
| IsProvisional | True for provisional groups |
| VisitStatus | `planned`, `in_progress`, `completed`, `cancelled`, or `provisional` |
| RoadKey, AreaKey, DateKey | Visit road / area / scheduled (or first detection) date |
| MeasuredPotholes | Measured potholes in the visit (within the exported scope) |
| MaterialCost, LabourCost | Σ over those potholes |
| **MobilisationCost** | Charged **once** for the visit |
| TotalEstimatedCost | Material + labour + mobilisation |
| ActualCost | Recorded actual cost of the work order, nullable |

## Dimensions

| Table | Key | Columns |
|---|---|---|
| DimDate | DateKey | Date, Day, Month, MonthNumber, Quarter, Year, YearMonth — continuous from the first detection month to the export date |
| DimRoad | RoadKey | RoadName, RoadCode, AreaKey (informational — do **not** relate to DimArea), Ward, Importance |
| DimArea | AreaKey | Locality, Ward, City, Region |
| DimSeverity | SeverityKey | SeverityName, SortOrder (sort SeverityName by SortOrder) |
| DimStatus | StatusKey | StatusName, SortOrder |
| DimModelVersion | ModelVersion | Repository, Checkpoint, EvaluationDate, Precision, Recall, mAP50, mAP50_95, EvaluationDataset — metrics are blank unless an evaluation was actually recorded |

## Reconciliation

Every export writes `export-manifest.json` with checks comparing the export against the live application
for the same scope: unique potholes, frame-level detections, variable cost, mobilisation and total budget.
An export whose checks fail is still written, but the application and CLI report the failure.
