# Relationships (Model view)

Create exactly these. Cardinality is many-to-one (`*` → `1`) and cross-filter direction is **Single**
unless stated otherwise.

| From (many) | To (one) | Active | Notes |
|---|---|---|---|
| FactPothole[DateKey] | DimDate[DateKey] | Yes | Detection date |
| FactPothole[VerifiedDateKey] | DimDate[DateKey] | **No** | Used with `USERELATIONSHIP` in "Verified (by review date)" |
| FactPothole[RepairedDateKey] | DimDate[DateKey] | **No** | Used with `USERELATIONSHIP` in "Repaired (by repair date)" |
| FactPothole[RoadKey] | DimRoad[RoadKey] | Yes | |
| FactPothole[AreaKey] | DimArea[AreaKey] | Yes | |
| FactPothole[SeverityKey] | DimSeverity[SeverityKey] | Yes | |
| FactPothole[StatusKey] | DimStatus[StatusKey] | Yes | |
| FactPothole[ModelVersion] | DimModelVersion[ModelVersion] | Yes | |
| FactRepairVisit[DateKey] | DimDate[DateKey] | Yes | Visit-level visuals only |
| FactRepairVisit[RoadKey] | DimRoad[RoadKey] | Yes | Visit-level visuals only |
| FactRepairVisit[AreaKey] | DimArea[AreaKey] | Yes | Visit-level visuals only |

## Do not create

- **FactRepairVisit ↔ FactPothole.** A fact-to-fact join repeats the visit's mobilisation on every pothole row
  and inflates budgets. The `Mobilisation Cost` measure resolves visits through `RepairVisitKey` instead.
- **DimRoad → DimArea.** FactPothole already relates to both; adding this creates an ambiguous filter path.
- Any **bidirectional** filter. None is needed.

## Mark as date table

Select `DimDate` → *Table tools → Mark as date table* → `Date`. Sort `DimDate[Month]` by `MonthNumber`,
`DimSeverity[SeverityName]` by `SortOrder` and `DimStatus[StatusName]` by `SortOrder`.

## Hide technical columns

Hide all `*Key` columns in the fact tables, plus `IsUnique`, from report view. Users should slice by the
dimension attributes.
