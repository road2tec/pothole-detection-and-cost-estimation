import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="RoadSight home">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill={dark ? '#262a30' : '#1c1f23'} />
        <path d="M7 21c2.5-1.6 5.6-2.4 9-2.4s6.5.8 9 2.4" stroke="#f59e0b" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <ellipse cx="16" cy="14" rx="6" ry="3.2" fill="#f59e0b" />
      </svg>
      <span className={cn('text-[15px] font-semibold tracking-tight', dark ? 'text-white' : 'text-ink')}>
        RoadSight
      </span>
    </Link>
  );
}

const LINKS = [
  ['/product', 'Product'],
  ['/features', 'Features'],
  ['/how-it-works', 'How it works'],
  ['/methodology', 'AI methodology'],
  ['/help', 'Help & contact'],
] as const;

export function PublicLayout() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Site">
            {LINKS.map(([to, text]) => (
              <NavLink key={to} to={to} className={({ isActive }) => cn('rounded-md px-3 py-2 text-[13.5px] font-medium', isActive ? 'text-ink' : 'text-muted hover:text-ink')}>
                {text}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            {status === 'authenticated' ? (
              <Button asChild>
                <Link to="/app">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link to="/register">Request access</Link>
                </Button>
              </>
            )}
          </div>
          <button className="ml-auto rounded-md p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-line px-4 py-3 md:hidden" aria-label="Site mobile">
            {LINKS.map(([to, text]) => (
              <Link key={to} to={to} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2 text-sm font-medium text-ink-2 hover:bg-subtle">
                {text}
              </Link>
            ))}
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" className="flex-1" asChild>
                <Link to="/login">Sign in</Link>
              </Button>
              <Button className="flex-1" asChild>
                <Link to="/register">Request access</Link>
              </Button>
            </div>
          </nav>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted">
              Automated pothole detection and repair-cost analysis for municipal and district road authorities. Detection uses a pretrained
              open model; every estimate shows how it was derived.
            </p>
          </div>
          <div className="text-[13px]">
            <div className="mb-2 font-semibold text-ink">Product</div>
            <ul className="space-y-1.5 text-muted">
              {LINKS.slice(0, 4).map(([to, text]) => (
                <li key={to}>
                  <Link to={to} className="hover:text-ink">
                    {text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-[13px]">
            <div className="mb-2 font-semibold text-ink">Support</div>
            <ul className="space-y-1.5 text-muted">
              <li>
                <Link to="/help" className="hover:text-ink">
                  Help & contact
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-ink">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-ink">
                  Request access
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line py-4 text-center text-xs text-muted">
          Automated Pothole Detection and Repair Cost Analysis · Department of Computer Engineering project, 2026–27
        </div>
      </footer>
    </div>
  );
}
