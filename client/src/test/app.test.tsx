import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- mocks -------------------------------------------------------------------
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
    refreshSession: vi.fn().mockResolvedValue(null),
  };
});

const authState: { user: any; status: string } = { user: null, status: 'anonymous' };
const login = vi.fn();
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ ...authState, login, logout: vi.fn(), setUser: vi.fn(), hasRole: (...r: string[]) => r.includes(authState.user?.role) }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

import { LoginPage } from '@/pages/auth/AuthPages';
import { AppLayout } from '@/layouts/AppLayout';
import { RequireRole } from '@/App';
import { FilterBar, useFilters } from '@/features/potholes/filters';
import { EmptyState, ErrorState, Pagination } from '@/components/ui/display';
import { SeverityBadge } from '@/components/domain';
import { TooltipProvider } from '@/components/ui/overlay';
import { fmt } from '@/lib/format';

function wrap(ui: ReactNode, path = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  login.mockReset();
  apiGet.mockResolvedValue({ data: { items: [], unread: 0, total: 0, reachable: true, detector: { ready: true, modelVersion: 'x' } } });
});

describe('login', () => {
  it('validates input before calling the API', async () => {
    wrap(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the server error message on failed sign-in', async () => {
    login.mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 401, data: { error: { message: 'Invalid email or password' } } } }));
    wrap(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.in');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith('a@b.in', 'wrongpass1');
  });
});

describe('role-based navigation', () => {
  const navLinks = () => within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getAllByRole('link').map((a) => a.textContent);

  it('inspectors do not see administration or engineering pages', () => {
    authState.user = { id: '1', name: 'Asha Patil', email: 'a@x.in', role: 'inspector' };
    authState.status = 'authenticated';
    wrap(
      <Routes>
        <Route path="/app" element={<AppLayout />} />
      </Routes>,
      '/app',
    );
    const links = navLinks();
    expect(links).toContain('New upload');
    expect(links).not.toContain('Users');
    expect(links).not.toContain('Review queue');
    expect(links).not.toContain('Power BI');
  });

  it('administrators see user management and configuration', () => {
    authState.user = { id: '2', name: 'Admin User', email: 'ad@x.in', role: 'admin' };
    wrap(
      <Routes>
        <Route path="/app" element={<AppLayout />} />
      </Routes>,
      '/app',
    );
    const links = navLinks();
    expect(links).toEqual(expect.arrayContaining(['Users', 'Configuration', 'Audit log', 'Review queue', 'Power BI']));
  });

  it('RequireRole blocks direct navigation to a forbidden page', () => {
    authState.user = { id: '1', name: 'Asha', email: 'a@x.in', role: 'inspector' };
    wrap(
      <RequireRole roles={['admin']}>
        <div>secret settings</div>
      </RequireRole>,
    );
    expect(screen.queryByText('secret settings')).not.toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });
});

describe('filters and pagination', () => {
  function Harness() {
    const { filters, set, reset } = useFilters();
    const loc = useLocation();
    return (
      <>
        <FilterBar filters={filters} set={set} reset={reset} />
        <output data-testid="qs">{loc.search}</output>
      </>
    );
  }

  it('writes chosen filters to the URL and clears them', async () => {
    apiGet.mockImplementation(async (url: string) => (url === '/places/areas' ? { data: { items: [{ _id: 'a', ward: 'W4', locality: 'Indapur' }] } } : { data: { items: [] } }));
    wrap(<Harness />, '/app/potholes');
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'severe');
    expect(screen.getByTestId('qs').textContent).toContain('severity=severe');
    await userEvent.selectOptions(await screen.findByLabelText('Ward'), 'W4');
    expect(screen.getByTestId('qs').textContent).toContain('ward=W4');
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByTestId('qs').textContent).toBe('');
  });

  it('pagination disables out-of-range navigation', async () => {
    const onPage = vi.fn();
    wrap(<Pagination page={1} pages={3} total={60} onPage={onPage} />);
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('states and labels', () => {
  it('error state offers a retry', async () => {
    const retry = vi.fn();
    wrap(<ErrorState message="Cannot reach the server" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the server');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('empty state renders its message', () => {
    wrap(<EmptyState title="No potholes detected" description="Genuine empty result" />);
    expect(screen.getByText('No potholes detected')).toBeInTheDocument();
  });

  it('severity is always shown as text, not colour alone', () => {
    wrap(
      <>
        <SeverityBadge severity="severe" />
        <SeverityBadge severity={null} />
      </>,
    );
    expect(screen.getByText('Severe')).toBeInTheDocument();
    expect(screen.getByText('Not classified')).toBeInTheDocument();
  });

  it('formats missing values as a dash, never zero', () => {
    expect(fmt.inr(null)).toBe('—');
    expect(fmt.m3(undefined)).toBe('—');
    expect(fmt.inr(1201.2)).toContain('1,201.20');
  });
});
