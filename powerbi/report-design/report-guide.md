# Report-building guide

Build the report in Power BI Desktop after loading the queries (`../power-query/`), creating the
relationships (`../schema/relationships.md`) and adding the measures (`../measures/measures.dax`).
Use the theme file `roadsight-theme.json` in this folder (*View → Themes → Browse for themes*).

General rules:

- Every visual has a title, axis titles with units (₹, m³, count), data labels where useful, and a tooltip.
- Severity is always labelled in text (legend or data label), never by colour alone.
- Say "Estimated" on every budget visual and "Actual" only on `Actual Repair Cost`.
- Never put `Total Potholes (frame-level detections)` next to `Unique Potholes` without both labels.
- Add a page-level slicer panel on every page: `DimDate[Date]` (between), `DimArea[Ward]`, `DimArea[Locality]`,
  `DimRoad[RoadName]`, `DimSeverity[SeverityName]`, `DimStatus[StatusName]`. Sync slicers across pages.
- If demo records were exported, add a visual-level filter `FactPothole[IsDemo] = False` or a clear
  "Includes demo data" text box.

## Page 1 — Overview (KPI cards)

Card visuals (new card visual, one measure each):

| Card | Measure | Format |
|---|---|---|
| Total detected potholes | Total Potholes (frame-level detections) | Whole number |
| Unique potholes | Unique Potholes | Whole number |
| Verified | Verified Potholes | Whole number |
| Pending review | Pending Review | Whole number |
| Minor / Moderate / Severe | Minor Potholes / Moderate Potholes / Severe Potholes | Whole number |
| Repaired | Repaired Potholes | Whole number |
| Total estimated repair budget | Total Estimated Budget | ₹ #,##0 |
| Estimated cost of severe potholes | Severe Estimated Cost | ₹ #,##0 |
| Budget variance | Budget Variance (blank when no target) | ₹ #,##0; red when negative |

Plus a table "Potholes by area": rows `DimArea[Ward]`, `DimArea[Locality]`; values `Unique Potholes`, `Severe Potholes`, `Estimated Budget by Area`.

## Page 2 — A. Total potholes

- Line chart: axis `DimDate[YearMonth]` (switchable to `Date` via drill / field parameter for daily and weekly),
  values `Unique Potholes`, `Verified (by review date)`, `Repaired (by repair date)`. Title "Detected vs verified vs repaired".
- Clustered column: axis `DimRoad[RoadName]`, value `Unique Potholes` (top 15 by value).

## Page 3 — B. Severity distribution

- Donut: legend `DimSeverity[SeverityName]` (sorted), values `Unique Potholes`, data labels "Category, value, % of total".
- Stacked bar: axis `DimArea[Locality]`, legend `DimSeverity[SeverityName]`, values `Unique Potholes`.
- Card: `Severe Awaiting Repair`.
- Stacked column: axis `DimDate[YearMonth]`, legend `DimSeverity[SeverityName]`, values `Unique Potholes` ("Severity trend").

## Page 4 — C. Area-wise comparison

- Clustered bar: `DimRoad[RoadName]` / `DimArea[Ward]` / `DimArea[Locality]` (use a field parameter to switch), value `Unique Potholes`.
- 100% stacked bar: same axis, legend `DimSeverity[SeverityName]`.
- Column chart: same axis, value `Estimated Budget by Area`.
- Table: area, `Unique Potholes`, `Severe Potholes`, `Estimated Budget by Area`, `MAX(FactPothole[PriorityScore])` as "Highest priority".
- Map (Azure Maps or ArcGIS): latitude `FactPothole[Latitude]`, longitude `FactPothole[Longitude]`, legend `DimSeverity[SeverityName]`,
  tooltip `PotholeKey`. Add a visual-level filter `Latitude is not blank`; potholes without coordinates are not plotted.

## Page 5 — D. Estimated repair budget

- Card: `Total Estimated Budget`, `Unrepaired Estimated Budget`.
- Stacked column (single column) or donut: values `Material Cost`, `Labour Cost`, `Mobilisation Cost` ("Budget breakdown").
- Clustered column: axis `DimSeverity[SeverityName]`, value `Estimated Budget by Severity` — subtitle "Material + labour; mobilisation is per visit".
- Bar: axis `DimRoad[RoadName]` and `DimArea[Locality]`, value `Total Estimated Budget`.
- Line + column: axis `DimDate[YearMonth]`, columns `Monthly Budget Trend`.
- Clustered column: axis `FactRepairVisit[RepairVisitKey]` (filter `VisitStatus = completed`), values
  `SUM(FactRepairVisit[TotalEstimatedCost])` and `SUM(FactRepairVisit[ActualCost])` ("Budget vs actual, completed work orders").

## Page 6 — Operations & quality

- Funnel: `DimStatus[StatusName]` (sorted), `Unique Potholes` ("Repair status funnel").
- Column: `FactPothole[VerificationStatus]`, `Unique Potholes` ("Review backlog").
- Histogram: bin `FactPothole[Confidence]` (*New group → Bin size 0.1*), `Unique Potholes` ("Detection confidence — model score, not accuracy").
- Cards: `Verification Rate`, `Repair Completion Rate`, `Measurement Rate`, `Average Estimated Cost per Pothole`.
- Table: `DimModelVersion` columns with `Model Precision`, `Model Recall`, `Model mAP50`, `Model mAP50-95`. These are blank unless
  an evaluation was recorded in the application — do not type numbers in manually.

## Validate before publishing

Compare against the application's Analytics page with the same filters (no filters = whole live dataset):

| Power BI measure | Application figure |
|---|---|
| Unique Potholes | Analytics → "Unique potholes" |
| Total Potholes (frame-level detections) | "Unique potholes" card hint |
| Total Estimated Budget | "Total estimated budget" |
| Mobilisation Cost | Budget breakdown → Mobilisation |

The export manifest (`export-manifest.json`) already records these checks for the exported data.
