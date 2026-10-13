// One blank query per table. Name each query exactly as the comment above it.
// Types are set explicitly so blanks stay blank (null) instead of becoming 0.

// ---- FactPothole --------------------------------------------------------------
let
    Source = fnLoadTable("FactPothole"),
    Typed = Table.TransformColumnTypes(Source, {
        {"PotholeKey", type text}, {"DateKey", Int64.Type}, {"RoadKey", type text}, {"AreaKey", type text},
        {"SeverityKey", Int64.Type}, {"StatusKey", Int64.Type}, {"VerificationStatus", type text},
        {"Confidence", type number}, {"LengthM", type number}, {"WidthM", type number}, {"DepthM", type number},
        {"VolumeM3", type number}, {"MaterialCost", Currency.Type}, {"LabourCost", Currency.Type},
        {"EstimatedCost", Currency.Type}, {"ActualCost", Currency.Type},
        {"IsCalibrated", type logical}, {"IsMeasured", type logical}, {"IsVerified", type logical}, {"IsUnique", type logical},
        {"FrameDetections", Int64.Type}, {"RepairVisitKey", type text}, {"AssignedVisitCode", type text},
        {"ModelVersion", type text}, {"SourceType", type text}, {"DimensionSource", type text}, {"DepthSource", type text},
        {"CostConfigVersion", Int64.Type}, {"Latitude", type number}, {"Longitude", type number},
        {"PriorityScore", type number}, {"IsDemo", type logical}, {"VerifiedDateKey", Int64.Type}, {"RepairedDateKey", Int64.Type}
    }, "en-US"),
    // Empty strings from CSV become null for the key columns used in DAX.
    BlankKeys = Table.ReplaceValue(Typed, "", null, Replacer.ReplaceValue, {"RepairVisitKey", "AssignedVisitCode"})
in
    BlankKeys

// ---- FactRepairVisit ----------------------------------------------------------
let
    Source = fnLoadTable("FactRepairVisit"),
    Typed = Table.TransformColumnTypes(Source, {
        {"RepairVisitKey", type text}, {"IsProvisional", type logical}, {"VisitStatus", type text},
        {"RoadKey", type text}, {"AreaKey", type text}, {"DateKey", Int64.Type}, {"MeasuredPotholes", Int64.Type},
        {"MaterialCost", Currency.Type}, {"LabourCost", Currency.Type}, {"MobilisationCost", Currency.Type},
        {"TotalEstimatedCost", Currency.Type}, {"ActualCost", Currency.Type}
    }, "en-US")
in
    Typed

// ---- DimDate ------------------------------------------------------------------
let
    Source = fnLoadTable("DimDate"),
    Typed = Table.TransformColumnTypes(Source, {
        {"DateKey", Int64.Type}, {"Date", type date}, {"Day", Int64.Type}, {"Month", type text},
        {"MonthNumber", Int64.Type}, {"Quarter", type text}, {"Year", Int64.Type}, {"YearMonth", type text}
    }, "en-US")
in
    Typed

// ---- DimRoad ------------------------------------------------------------------
let
    Source = fnLoadTable("DimRoad"),
    Typed = Table.TransformColumnTypes(Source, {
        {"RoadKey", type text}, {"RoadName", type text}, {"RoadCode", type text}, {"AreaKey", type text},
        {"Ward", type text}, {"Importance", Int64.Type}
    }),
    // Text cells starting with = + - @ are exported with a leading apostrophe (formula-injection guard).
    Unescaped = Table.TransformColumns(Typed, {{"RoadName", each if Text.StartsWith(_, "'") then Text.Middle(_, 1) else _, type text}})
in
    Unescaped

// ---- DimArea ------------------------------------------------------------------
let
    Source = fnLoadTable("DimArea"),
    Typed = Table.TransformColumnTypes(Source, {{"AreaKey", type text}, {"Locality", type text}, {"Ward", type text}, {"City", type text}, {"Region", type text}})
in
    Typed

// ---- DimSeverity --------------------------------------------------------------
let
    Source = fnLoadTable("DimSeverity"),
    Typed = Table.TransformColumnTypes(Source, {{"SeverityKey", Int64.Type}, {"SeverityName", type text}, {"SortOrder", Int64.Type}})
in
    Typed

// ---- DimStatus ----------------------------------------------------------------
let
    Source = fnLoadTable("DimStatus"),
    Typed = Table.TransformColumnTypes(Source, {{"StatusKey", Int64.Type}, {"StatusName", type text}, {"SortOrder", Int64.Type}})
in
    Typed

// ---- DimModelVersion ----------------------------------------------------------
let
    Source = fnLoadTable("DimModelVersion"),
    Typed = Table.TransformColumnTypes(Source, {
        {"ModelVersion", type text}, {"Repository", type text}, {"Checkpoint", type text}, {"EvaluationDate", type date},
        {"Precision", type number}, {"Recall", type number}, {"mAP50", type number}, {"mAP50_95", type number}, {"EvaluationDataset", type text}
    }, "en-US")
in
    Typed

// ---- BudgetTarget (optional, manual) ------------------------------------------
// Home → Enter data → table "BudgetTarget" with one numeric column "Amount" (leave empty if no
// approved budget exists; Budget Variance then shows blank).
