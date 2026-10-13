import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Database, Download, ExternalLink, KeyRound, PieChart, RefreshCw, Settings2, Trash2, XCircle } from 'lucide-react';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { fmt } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input, Switch } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, ErrorState, LoadingBlock, Notice, PageHeader } from '@/components/ui/display';
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

const TABLES = ['FactPothole', 'FactRepairVisit', 'DimDate', 'DimRoad', 'DimArea', 'DimSeverity', 'DimStatus', 'DimModelVersion'];

function Check({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 className="size-4 text-ok" aria-label="Match" /> : <XCircle className="size-4 text-danger" aria-label="Mismatch" />;
}

export default function PowerBIPage() {
  const { user } = useAuth();
  const admin = user!.role === 'admin';
  const qc = useQueryClient();
  const [includeDemo, setIncludeDemo] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const status = useQuery({ queryKey: ['powerbi', 'status'], queryFn: async () => (await api.get('/integrations/powerbi/status')).data });
  const exports = useQuery({ queryKey: ['powerbi', 'exports'], queryFn: async () => (await api.get('/analytics/powerbi-export')).data.items as any[] });
  const config = useQuery({ queryKey: ['powerbi', 'config'], enabled: admin, queryFn: async () => (await api.get('/integrations/powerbi/configuration')).data });
  const refreshHistory = useQuery({ queryKey: ['powerbi', 'refreshes'], enabled: !!status.data?.servicePrincipal?.datasetConfigured, queryFn: async () => (await api.get('/integrations/powerbi/refresh')).data.items as any[] });

  const runExport = useMutation({
    mutationFn: () => api.post('/analytics/powerbi-export', { includeDemo }),
    onSuccess: (r) => {
      const checks = Object.values(r.data.job.checks ?? {}) as Array<{ ok: boolean }>;
      if (checks.every((c) => c.ok)) toast.success('Export complete — totals reconcile with the dashboard');
      else toast.error('Export complete but totals did not reconcile — see checks');
      qc.invalidateQueries({ queryKey: ['powerbi'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const refresh = useMutation({
    mutationFn: () => api.post('/integrations/powerbi/refresh'),
    onSuccess: () => {
      toast.success('Dataset refresh requested from Power BI');
      qc.invalidateQueries({ queryKey: ['powerbi', 'refreshes'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createKey = useMutation({
    mutationFn: () => api.post('/integrations/powerbi/api-keys', { name: keyName }),
    onSuccess: (r) => {
      setNewKey(r.data.key);
      setKeyName('');
      qc.invalidateQueries({ queryKey: ['powerbi', 'config'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revokeKey = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/powerbi/api-keys/${id}`),
    onSuccess: () => {
      toast.success('API key revoked');
      qc.invalidateQueries({ queryKey: ['powerbi', 'config'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (status.isLoading) return <Card><LoadingBlock rows={6} /></Card>;
  if (status.isError) return <Card><ErrorState message={errorMessage(status.error)} onRetry={() => status.refetch()} /></Card>;
  const s = status.data;
  const latest = exports.data?.find((e) => e.status === 'completed');
  const verification = s.servicePrincipal.verification;

  return (
    <>
      <PageHeader
        title="Power BI analytics"
        description="A normalised star schema exported from the live database, with DAX measures and Power Query scripts in the repository's powerbi/ folder. The native Analytics page uses the same definitions."
        actions={
          <Button onClick={() => runExport.mutate()} loading={runExport.isPending}>
            <Database /> Generate export now
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium text-muted">Report embedding</div>
            {s.secureEmbed.configured ? <Badge tone="ok">Configured</Badge> : <Badge>Setup required</Badge>}
          </div>
          <p className="mt-2 text-[13px] text-ink-2">{s.secureEmbed.configured ? 'Viewers sign in with their own Microsoft account; no token leaves this server.' : 'Set POWERBI_SECURE_EMBED_URL after publishing the report to Power BI Service.'}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium text-muted">Service principal</div>
            {!s.servicePrincipal.configured ? <Badge>Not configured</Badge> : verification.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="danger">Connection failed</Badge>}
          </div>
          <p className="mt-2 text-[13px] text-ink-2">
            {!s.servicePrincipal.configured ? 'Optional. Enables dataset refresh from this page.' : verification.connected ? `Verified live${verification.dataset ? ` · dataset “${verification.dataset.name}”` : ''}.` : verification.reason}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium text-muted">Latest data export</div>
            {latest ? <Badge tone="ok">Available</Badge> : <Badge>None yet</Badge>}
          </div>
          <p className="mt-2 text-[13px] text-ink-2">{latest ? `${fmt.dateTime(latest.createdAt)}${latest.includeDemo ? ' · includes demo data' : ''}` : 'Generate an export or let Power BI request the data feed.'}</p>
        </Card>
      </div>

      <Tabs defaultValue={s.secureEmbed.configured ? 'report' : 'data'} className="mt-6">
        <TabsList>
          <TabsTrigger value="report">
            <PieChart /> Report
          </TabsTrigger>
          <TabsTrigger value="data">
            <Database /> Data export
          </TabsTrigger>
          <TabsTrigger value="setup">
            <Settings2 /> Setup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-4">
          {s.secureEmbed.configured ? (
            <Card className="overflow-hidden">
              <CardHeader
                title="Published Power BI report"
                actions={
                  <Button variant="secondary" size="sm" asChild>
                    <a href={s.secureEmbed.url} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open in Power BI
                    </a>
                  </Button>
                }
              />
              <iframe title="Power BI report" src={s.secureEmbed.url} className="h-[75vh] w-full border-0" allowFullScreen />
            </Card>
          ) : (
            <Card>
              <CardBody className="space-y-4">
                <Notice tone="warn" title="No Power BI report is connected">
                  This page does not imitate a Power BI report. Build the report from the export (instructions in <span className="font-mono">powerbi/README.md</span>), publish it to Power BI Service, then set
                  <span className="font-mono"> POWERBI_SECURE_EMBED_URL</span> in <span className="font-mono">server/.env</span> to show it here. Live charts with identical definitions are on the Analytics page.
                </Notice>
              </CardBody>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="data" className="mt-4 space-y-6">
          <Card>
            <CardHeader
              title="Star-schema export"
              description="FactPothole (variable cost only) + FactRepairVisit (mobilisation once per visit) + dimensions"
              actions={
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Switch checked={includeDemo} onCheckedChange={setIncludeDemo} aria-label="Include demo data" />
                  Include demo data
                </label>
              }
            />
            {!latest ? (
              <CardBody>
                <p className="text-[13px] text-muted">No export has been generated yet.</p>
              </CardBody>
            ) : (
              <>
                <div className="grid gap-6 p-5 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-[13px] font-medium text-ink">Files ({fmt.dateTime(latest.createdAt)})</div>
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {latest.files.map((f: any) => (
                        <li key={f.name} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                          <span className="font-mono text-ink">{f.name}</span>
                          <span className="num text-xs text-muted">
                            {fmt.int(f.rows)} rows · {fmt.bytes(f.sizeBytes)}
                          </span>
                          <Button variant="ghost" size="icon-sm" aria-label={`Download ${f.name}`} onClick={() => downloadFile(`/analytics/powerbi-export/${latest._id}/${f.name}`, f.name).catch((e) => toast.error(errorMessage(e)))}>
                            <Download />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-2 text-[13px] font-medium text-ink">Reconciliation with the live dashboard</div>
                    <Table>
                      <THead>
                        <tr>
                          <Th>Measure</Th>
                          <Th className="text-right">Export</Th>
                          <Th className="text-right">Dashboard</Th>
                          <Th />
                        </tr>
                      </THead>
                      <TBody>
                        {Object.entries(latest.checks ?? {}).map(([k, c]: [string, any]) => (
                          <Tr key={k}>
                            <Td>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</Td>
                            <Td className="num text-right">{k.toLowerCase().includes('cost') || k.includes('Budget') ? fmt.inr(c.export) : fmt.int(c.export)}</Td>
                            <Td className="num text-right">{k.toLowerCase().includes('cost') || k.includes('Budget') ? fmt.inr(c.dashboard) : fmt.int(c.dashboard)}</Td>
                            <Td>
                              <Check ok={c.ok} />
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </Card>
          <Card>
            <CardHeader title="Export history" />
            <Table>
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>Trigger</Th>
                  <Th>Status</Th>
                  <Th>Scope</Th>
                  <Th className="text-right">Duration</Th>
                </tr>
              </THead>
              <TBody>
                {(exports.data ?? []).map((e) => (
                  <Tr key={e._id}>
                    <Td>{fmt.dateTime(e.createdAt)}</Td>
                    <Td>
                      {e.trigger}
                      {e.requestedBy ? ` · ${e.requestedBy.name}` : ''}
                    </Td>
                    <Td>{e.status === 'completed' ? <Badge tone="ok">Completed</Badge> : e.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <Badge>Running</Badge>}</Td>
                    <Td>{e.includeDemo ? 'Live + demo' : 'Live only'}</Td>
                    <Td className="num text-right">{e.durationMs ? `${e.durationMs} ms` : '—'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="setup" className="mt-4 space-y-6">
          <Card>
            <CardHeader title="Connect Power BI Desktop to the live data feed" />
            <CardBody className="space-y-3 text-[13.5px] text-ink-2">
              <ol className="list-decimal space-y-2 pl-5">
                <li>An administrator creates a read-only API key below (shown once).</li>
                <li>
                  In Power BI Desktop choose <em>Get data → Blank query</em> and paste the scripts from <span className="font-mono">powerbi/power-query/</span>, setting the <span className="font-mono">BaseUrl</span> and <span className="font-mono">ApiKey</span> parameters.
                </li>
                <li>
                  Create the relationships in <span className="font-mono">powerbi/schema/relationships.md</span> and add the measures from <span className="font-mono">powerbi/measures/measures.dax</span>.
                </li>
                <li>
                  For scheduled refresh in Power BI Service, the data feed URL must be reachable from Microsoft's cloud (public HTTPS or an on-premises data gateway). Without that, use the CSV export and refresh manually.
                </li>
              </ol>
              <div className="rounded-lg border border-line bg-[#faf9f6] p-3">
                <div className="text-xs text-muted">Data feed base URL</div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{s.dataFeed.baseUrl}</code>
                  <Button variant="ghost" size="icon-sm" aria-label="Copy URL" onClick={() => navigator.clipboard.writeText(s.dataFeed.baseUrl).then(() => toast.success('Copied'))}>
                    <Copy />
                  </Button>
                </div>
                <div className="mt-2 text-xs text-muted">Tables: {TABLES.map((t) => `${t}.csv`).join(', ')}</div>
              </div>
            </CardBody>
          </Card>
          {admin && (
            <Card>
              <CardHeader title="Read-only API keys" description="Used by Power BI to fetch the data feed. Keys can read analytics exports only." />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Key name" className="min-w-[240px] flex-1">
                    {(p) => <Input {...p} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Power BI scheduled refresh" />}
                  </Field>
                  <Button onClick={() => createKey.mutate()} disabled={keyName.trim().length < 3} loading={createKey.isPending}>
                    <KeyRound /> Create key
                  </Button>
                </div>
                {config.data?.apiKeys?.length ? (
                  <Table>
                    <THead>
                      <tr>
                        <Th>Name</Th>
                        <Th>Prefix</Th>
                        <Th>Created</Th>
                        <Th>Last used</Th>
                        <Th>Status</Th>
                        <Th />
                      </tr>
                    </THead>
                    <TBody>
                      {config.data.apiKeys.map((k: any) => (
                        <Tr key={k._id}>
                          <Td className="font-medium text-ink">{k.name}</Td>
                          <Td className="font-mono text-xs">{k.prefix}…</Td>
                          <Td>{fmt.date(k.createdAt)}</Td>
                          <Td>{k.lastUsedAt ? fmt.relative(k.lastUsedAt) : 'Never'}</Td>
                          <Td>{k.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="ok">Active</Badge>}</Td>
                          <Td className="text-right">
                            {!k.revokedAt && (
                              <Button variant="ghost" size="sm" onClick={() => revokeKey.mutate(k._id)}>
                                <Trash2 /> Revoke
                              </Button>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <p className="text-[13px] text-muted">No API keys yet.</p>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Power BI Service (optional)"
              description="Service principal for verification and dataset refresh"
              actions={
                admin &&
                s.servicePrincipal.datasetConfigured && (
                  <Button variant="secondary" onClick={() => refresh.mutate()} loading={refresh.isPending}>
                    <RefreshCw /> Refresh dataset now
                  </Button>
                )
              }
            />
            <CardBody className="space-y-3 text-[13.5px] text-ink-2">
              {!s.servicePrincipal.configured ? (
                <p>
                  Not configured. Set <span className="font-mono">POWERBI_TENANT_ID</span>, <span className="font-mono">POWERBI_CLIENT_ID</span>, <span className="font-mono">POWERBI_CLIENT_SECRET</span>,
                  <span className="font-mono"> POWERBI_WORKSPACE_ID</span> and optionally <span className="font-mono">POWERBI_DATASET_ID</span> / <span className="font-mono">POWERBI_REPORT_ID</span> in <span className="font-mono">server/.env</span>. The tenant must allow service principals to use Power BI APIs and the app must be a member of the workspace. Secrets stay on the server.
                </p>
              ) : (
                <>
                  <p>{verification.connected ? 'Microsoft confirmed the configuration on the last status check.' : `Microsoft rejected the configuration: ${verification.reason}`}</p>
                  {refreshHistory.data?.length ? (
                    <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
                      {refreshHistory.data.map((r, i) => (
                        <li key={i} className="flex justify-between px-3 py-2">
                          <span>{fmt.dateTime(r.startTime)}</span>
                          <span>{r.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={newKey !== null}
        onOpenChange={(o) => !o && setNewKey(null)}
        title="Copy your API key now"
        description="This is the only time the key is shown. Store it in Power BI's data source credentials."
        footer={
          <Button onClick={() => navigator.clipboard.writeText(newKey ?? '').then(() => toast.success('Copied'))}>
            <Copy /> Copy key
          </Button>
        }
      >
        <code className="block break-all rounded-md bg-subtle p-3 font-mono text-[12.5px] text-ink">{newKey}</code>
      </Dialog>
    </>
  );
}
