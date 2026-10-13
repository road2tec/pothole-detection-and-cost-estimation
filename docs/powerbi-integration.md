# Power BI integration

The full guide, star schema, DAX measures, Power Query scripts and report design live in
[`../powerbi/README.md`](../powerbi/README.md). This page summarises how the pieces connect.

```
MongoDB ──► analytics/service.ts (business definitions) ──► React Analytics page
                    │
                    └─► analytics/powerbiExport.ts ──► 8 star-schema CSVs + export-manifest.json (reconciliation)
                              ▲                               │
   POST /analytics/powerbi-export (UI)                         ├─► powerbi/exports/ (npm --prefix server run export:powerbi)
   GET  /analytics/powerbi-export/latest/<T>.csv (X-Api-Key) ◄─┘─► Power BI Desktop / Service (Power Query Web.Contents)
                                                                         │
   Power BI Service ◄── service principal (server-side: verify + refresh) ┘
   React Power BI page ◄── secure-embed URL iframe (viewer's own Microsoft sign-in)
```

## What works without Microsoft credentials

* CSV export from the UI or CLI, with reconciliation checks against the live dashboard.
* The authenticated data feed with read-only API keys.
* The Power BI page shows an explicit **setup-required** state and the steps to finish — it never imitates a report.

## What needs your tenant

| Feature | Requirement |
|---|---|
| Show the published report in the app | Publish the report, copy its *Secure embed* link to `POWERBI_SECURE_EMBED_URL` |
| Scheduled refresh in Power BI Service | Data feed reachable from Microsoft's cloud (public HTTPS) or an on-premises data gateway |
| "Refresh dataset now" + refresh history + live verification | Azure AD app (service principal), tenant setting allowing SPs to use Power BI APIs, app added to the workspace, `POWERBI_*` variables |

## Verified vs not verified

* Verified here: export generation at 10,000 records (≈1.2 s), reconciliation checks pass, API-key access and
  revocation (automated tests), setup-required status.
* **Not verified here**: the DAX and M code inside Power BI Desktop, and the Microsoft REST calls against a real tenant —
  Power BI Desktop and a tenant were not available. The code follows Microsoft's documented APIs; validate after setup.
