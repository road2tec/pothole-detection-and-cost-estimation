// Create these in Power BI Desktop: Home → Transform data → Manage Parameters → New.
//
//  Name        Type   Current value (example)
//  ----------  -----  -----------------------------------------------------------------
//  Source      Text   "feed"   ("feed" = live API data feed, "folder" = exported CSV files)
//  BaseUrl     Text   "http://localhost:4000/api/v1/analytics/powerbi-export/latest"
//  ApiKey      Text   (read-only key created on the application's Power BI page)
//  ExportDir   Text   "D:\Projects 2026-2027\pothole detection and cost estimation\powerbi\exports"
//
// Then add the helper function below as a blank query named fnLoadTable.
// Data source privacy: set the API URL to "Organizational". Authentication: Anonymous
// (the API key is sent in the X-Api-Key header, never in the URL).

// ---- fnLoadTable --------------------------------------------------------------
(tableName as text) as table =>
let
    Raw =
        if Source = "folder" then
            File.Contents(ExportDir & "\" & tableName & ".csv")
        else
            Web.Contents(
                BaseUrl,
                [
                    RelativePath = tableName & ".csv",
                    Headers = [#"X-Api-Key" = ApiKey],
                    Timeout = #duration(0, 0, 5, 0)
                ]
            ),
    Csv = Csv.Document(Raw, [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Csv, [PromoteAllScalars = true])
in
    Promoted
