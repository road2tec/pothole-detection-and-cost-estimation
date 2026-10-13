import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { api, downloadFile, errorMessage, toParams } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { Paged } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { FilterBar, useFilters } from '@/features/potholes/filters';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, Pagination } from '@/components/ui/display';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

export default function ReportsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { filters, set, reset } = useFilters();
  const [title, setTitle] = useState('Pothole Maintenance Report');
  const [csvType, setCsvType] = useState<'potholes' | 'areas' | 'severity' | 'budget'>('potholes');
  const [page, setPage] = useState(1);
  const history = useQuery({ queryKey: ['reports', page], queryFn: async () => (await api.get<Paged<any>>('/reports/history', { params: { page, limit: 15 } })).data });

  const pdf = useMutation({
    mutationFn: async () => (await api.post('/reports/pdf', { title, filters: toParams(filters) }, { timeout: 180_000 })).data.report,
    onSuccess: async (r) => {
      toast.success(`PDF ready (${r.potholeCount} potholes, ${(r.durationMs / 1000).toFixed(1)} s)`);
      qc.invalidateQueries({ queryKey: ['reports'] });
      await downloadFile(`/reports/${r._id}/download`, 'report.pdf');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const csv = useMutation({
    mutationFn: async () => (await api.post('/reports/csv', { type: csvType, filters: toParams(filters) })).data,
    onSuccess: async (d) => {
      toast.success(`${d.rows} row(s) exported${d.truncated ? ' (truncated at 50,000)' : ''}`);
      qc.invalidateQueries({ queryKey: ['reports'] });
      await downloadFile(`/reports/${d.report._id}/download`, `${csvType}.csv`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Reports" description="Maintenance reports record the filters, model version(s) and cost configuration used, so their figures can be audited later." />
      <Card className="mb-6">
        <CardHeader title="Scope" description={user!.role === 'inspector' ? 'Reports include only potholes from your own uploads.' : 'Applies to both PDF and CSV.'} />
        <CardBody>
          <FilterBar filters={filters} set={set} reset={reset} allowDemo={user!.role !== 'inspector'} />
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="PDF maintenance report" description="Summary, severity and area tables, cost configuration, and a pothole register with images" />
          <CardBody className="space-y-4">
            <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />}</Field>
            <Notice tone="neutral">The register lists up to 500 highest-priority potholes; totals always cover every record in scope. Uncalibrated or manually corrected records are annotated.</Notice>
            <Button onClick={() => pdf.mutate()} loading={pdf.isPending}>
              <FileText /> Generate PDF
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="CSV export" description="Formula-safe CSV for spreadsheets and Power BI" />
          <CardBody className="space-y-4">
            <Field label="Dataset">
              {(p) => (
                <Select {...p} value={csvType} onChange={(e) => setCsvType(e.target.value as typeof csvType)}>
                  <option value="potholes">Pothole-level data</option>
                  <option value="areas">Area-wise summary (by road)</option>
                  <option value="severity">Severity-wise summary</option>
                  <option value="budget">Budget summary</option>
                </Select>
              )}
            </Field>
            <Button onClick={() => csv.mutate()} loading={csv.isPending}>
              <FileSpreadsheet /> Export CSV
            </Button>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Report history" description={user!.role === 'admin' ? 'All reports' : 'Reports you generated'} />
        {history.isLoading ? (
          <LoadingBlock />
        ) : history.isError ? (
          <ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} />
        ) : !history.data?.items.length ? (
          <EmptyState icon={<FileText />} title="No reports yet" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Report</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Records</Th>
                  <Th>Cost config</Th>
                  <Th>Generated</Th>
                  <Th />
                </tr>
              </THead>
              <TBody>
                {history.data.items.map((r) => (
                  <Tr key={r._id}>
                    <Td className="font-medium text-ink">{r.title}</Td>
                    <Td className="uppercase">{r.kind}{r.csvType ? ` · ${r.csvType}` : ''}</Td>
                    <Td>{r.status === 'ready' ? <Badge tone="ok">Ready</Badge> : r.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <Badge>Generating</Badge>}</Td>
                    <Td className="num text-right">{r.potholeCount ?? '—'}</Td>
                    <Td>v{r.costConfigSnapshot?.version ?? '—'}</Td>
                    <Td>
                      {fmt.dateTime(r.createdAt)}
                      {r.generatedBy?.name && <div className="text-xs text-muted">{r.generatedBy.name}</div>}
                    </Td>
                    <Td className="text-right">
                      {r.status === 'ready' && (
                        <Button variant="ghost" size="sm" onClick={() => downloadFile(`/reports/${r._id}/download`, `report.${r.kind}`).catch((e) => toast.error(errorMessage(e)))}>
                          <Download /> {fmt.bytes(r.sizeBytes)}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={history.data.page} pages={history.data.pages} total={history.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
