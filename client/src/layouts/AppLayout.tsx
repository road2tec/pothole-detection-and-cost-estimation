import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  Briefcase,
  ClipboardCheck,
  Cpu,
  FileText,
  Gauge,
  HelpCircle,
  History,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Map as MapIcon,
  Menu,
  PieChart,
  Settings,
  ShieldCheck,
  Upload as UploadIcon,
  User as UserIcon,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, label } from '@/lib/format';
import type { Role } from '@/lib/types';
import { useAuth } from '@/features/auth/AuthContext';
import { Logo } from './PublicLayout';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui/overlay';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
  end?: boolean;
}

const ALL: Role[] = ['admin', 'engineer', 'inspector'];
const STAFF: Role[] = ['admin', 'engineer'];

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [{ to: '/app', label: 'Dashboard', icon: <LayoutDashboard />, roles: ALL, end: true }],
  },
  {
    title: 'Field work',
    items: [
      { to: '/app/upload', label: 'New upload', icon: <UploadIcon />, roles: ALL },
      { to: '/app/uploads', label: 'Uploads & jobs', icon: <History />, roles: ALL },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/app/review', label: 'Review queue', icon: <ClipboardCheck />, roles: STAFF },
      { to: '/app/potholes', label: 'Potholes', icon: <ListOrdered />, roles: ALL },
      { to: '/app/map', label: 'Map', icon: <MapIcon />, roles: ALL },
      { to: '/app/priority', label: 'Repair priority', icon: <Gauge />, roles: STAFF },
      { to: '/app/repairs', label: 'Budget & work orders', icon: <Wallet />, roles: STAFF },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: <BarChart3 />, roles: ALL },
      { to: '/app/powerbi', label: 'Power BI', icon: <PieChart />, roles: STAFF },
      { to: '/app/reports', label: 'Reports', icon: <FileText />, roles: ALL },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/app/users', label: 'Users', icon: <Users />, roles: ['admin'] },
      { to: '/app/jobs', label: 'Processing jobs', icon: <Briefcase />, roles: ['admin'] },
      { to: '/app/model', label: 'AI model', icon: <Cpu />, roles: ALL },
      { to: '/app/settings', label: 'Configuration', icon: <Settings />, roles: ['admin'] },
      { to: '/app/audit', label: 'Audit log', icon: <ShieldCheck />, roles: ['admin'] },
    ],
  },
];

function AiStatusPill() {
  const { data, isError } = useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => (await api.get('/ai/status')).data,
    refetchInterval: 30_000,
  });
  const ready = data?.reachable && data?.detector?.ready;
  const text = isError || !data ? 'AI status unknown' : !data.reachable ? 'AI service offline' : ready ? 'AI model ready' : `AI model ${data.detector?.status ?? 'not ready'}`;
  return (
    <Tooltip content={ready ? `Model ${data.detector.modelVersion}` : data?.error ?? data?.detector?.error ?? 'Detection is unavailable until the AI service is ready.'}>
      <Link
        to="/app/model"
        className={cn(
          'hidden items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex',
          ready ? 'border-[#bfe3ca] bg-ok-soft text-ok' : 'border-[#f4c7c2] bg-danger-soft text-danger',
        )}
      >
        <span className={cn('size-1.5 rounded-full', ready ? 'bg-ok' : 'bg-danger')} />
        {text}
      </Link>
    </Tooltip>
  );
}

function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: async () => (await api.get('/notifications', { params: { limit: 1, unread: 'true' } })).data,
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <Link to="/app/notifications" className="relative rounded-md p-2 text-ink-2 hover:bg-subtle" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
      <Bell className="size-[18px]" />
      {unread > 0 && (
        <span className="num absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}

function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {SECTIONS.map((section) => {
        const items = section.items.filter((i) => i.roles.includes(role));
        if (!items.length) return null;
        return (
          <div key={section.title}>
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-graphite-600">{section.title}</div>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors [&_svg]:size-4',
                        isActive ? 'bg-graphite-800 text-white [&_svg]:text-[#f5b14a]' : 'text-[#b8bdc4] hover:bg-graphite-800/60 hover:text-white',
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-auto">
        <NavLink to="/app/help" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium text-[#b8bdc4] hover:bg-graphite-800/60 hover:text-white">
          <HelpCircle className="size-4" /> Help & troubleshooting
        </NavLink>
      </div>
    </nav>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  if (!user) return null;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen flex-col bg-graphite-900 lg:flex">
        <div className="flex h-14 items-center border-b border-graphite-800 px-5">
          <Logo dark />
        </div>
        <Sidebar role={user.role} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-graphite-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-graphite-900 shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-graphite-800 px-5">
              <Logo dark />
              <button className="rounded-md p-1.5 text-[#b8bdc4] hover:bg-graphite-800" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
            <Sidebar role={user.role} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-2 text-ink-2 hover:bg-subtle lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <AiStatusPill />
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-subtle" aria-label="Account menu">
                <span className="grid size-8 place-items-center rounded-full bg-graphite-800 text-xs font-semibold text-white">
                  {user.name
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-[13px] font-medium leading-tight text-ink">{user.name}</span>
                  <span className="block text-[11.5px] leading-tight text-muted">{label('role', user.role)}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => navigate('/app/profile')}>
                  <UserIcon /> Profile & security
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/app/notifications')}>
                  <Activity /> Notifications
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/app/help')}>
                  <HelpCircle /> Help
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
