/**
 * Generate the Power BI star-schema CSVs from the live database and copy them to
 * powerbi/exports/ for Power BI Desktop (Get data → Text/CSV or the folder query).
 *
 *   npm run export:powerbi              # live records only
 *   npm run export:powerbi -- --demo    # include clearly labelled demo records
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { runExportJob } from '../src/analytics/powerbiExport.js';
import { storagePath } from '../src/services/storage.js';

async function main() {
  const includeDemo = process.argv.includes('--demo');
  await connectDb();
  try {
    const job = await runExportJob({ includeDemo, trigger: 'cli' });
    const target = path.join(REPO_ROOT, 'powerbi', 'exports');
    await fsp.mkdir(target, { recursive: true });
    for (const f of [...job.files.map((x: { name?: string | null }) => x.name!), 'export-manifest.json']) {
      await fsp.copyFile(path.join(storagePath(job.directory!), f), path.join(target, f));
    }
    console.log(`Exported ${job.files.length} tables to ${target} in ${job.durationMs} ms`);
    for (const f of job.files) console.log(`  ${f.name?.padEnd(22)} ${f.rows} rows`);
    const checks = job.checks as Record<string, { ok: boolean; export: number; dashboard: number }>;
    const bad = Object.entries(checks).filter(([, c]) => !c.ok);
    console.log(bad.length ? `RECONCILIATION FAILED: ${JSON.stringify(bad)}` : 'Reconciliation with dashboard totals: all checks passed');
    if (bad.length) process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
