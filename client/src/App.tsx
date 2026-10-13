import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { PublicLayout } from '@/layouts/PublicLayout';
import { AppLayout } from '@/layouts/AppLayout';
import { TooltipProvider } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/display';
import type { Role } from '@/lib/types';
import { FeaturesPage, HelpPublicPage, HowItWorksPage, LandingPage, MethodologyPage, ProductPage } from '@/pages/public/PublicPages';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/pages/auth/AuthPages';

const DashboardPage = lazy(() => import('@/pages/app/DashboardPage'));
const UploadPage = lazy(() => import('@/pages/app/UploadPage'));
const UploadsPage = lazy(() => import('@/pages/app/UploadsPage'));
const UploadDetailPage = lazy(() => import('@/pages/app/UploadDetailPage'));
const CalibrationPage = lazy(() => import('@/pages/app/CalibrationPage'));
const PotholesPage = lazy(() => import('@/pages/app/PotholesPage'));
const PotholeDetailPage = lazy(() => import('@/pages/app/PotholeDetailPage'));
const MapPage = lazy(() => import('@/pages/app/MapPage'));
const RepairsPage = lazy(() => import('@/pages/app/RepairsPage'));
const AnalyticsPage = lazy(() => import('@/pages/app/AnalyticsPage'));
const PowerBIPage = lazy(() => import('@/pages/app/PowerBIPage'));
const ReportsPage = lazy(() => import('@/pages/app/ReportsPage'));
const UsersPage = lazy(() => import('@/pages/app/UsersPage'));
const SettingsPage = lazy(() => import('@/pages/app/SettingsPage'));
const ModelPage = lazy(() => import('@/pages/app/ModelPage'));
const AdminPages = lazy(() => import('@/pages/app/AdminPages'));
const AccountPages = lazy(() => import('@/pages/app/AccountPages'));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (count, err: any) => count < 2 && (err?.response?.status ?? 500) >= 500, refetchOnWindowFocus: false },
  },
});

function FullPageSpinner() {
  return (
    <div className="grid min-h-[50vh] place-items-center text-muted" role="status">
      <Loader2 className="size-6 animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title="You don't have access to this page"
        description="Your role does not include this area. If you need it, ask an administrator."
        action={
          <Button variant="secondary" asChild>
            <Link to="/app">Back to dashboard</Link>
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}

const staff: Role[] = ['admin', 'engineer'];
const admin: Role[] = ['admin'];
const page = (el: ReactNode, roles?: Role[]) => <Suspense fallback={<FullPageSpinner />}>{roles ? <RequireRole roles={roles}>{el}</RequireRole> : el}</Suspense>;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="product" element={<ProductPage />} />
        <Route path="features" element={<FeaturesPage />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="methodology" element={<MethodologyPage />} />
        <Route path="help" element={<HelpPublicPage />} />
      </Route>
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route
        path="app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={page(<DashboardPage />)} />
        <Route path="upload" element={page(<UploadPage />)} />
        <Route path="uploads" element={page(<UploadsPage />)} />
        <Route path="uploads/:id" element={page(<UploadDetailPage />)} />
        <Route path="uploads/:id/calibrate" element={page(<CalibrationPage />)} />
        <Route path="potholes" element={page(<PotholesPage key="manage" />)} />
        <Route path="review" element={page(<PotholesPage key="review" mode="review" />, staff)} />
        <Route path="priority" element={page(<PotholesPage key="priority" mode="priority" />, staff)} />
        <Route path="potholes/:id" element={page(<PotholeDetailPage />)} />
        <Route path="map" element={page(<MapPage />)} />
        <Route path="repairs" element={page(<RepairsPage />, staff)} />
        <Route path="analytics" element={page(<AnalyticsPage />)} />
        <Route path="powerbi" element={page(<PowerBIPage />, staff)} />
        <Route path="reports" element={page(<ReportsPage />)} />
        <Route path="users" element={page(<UsersPage />, admin)} />
        <Route path="settings" element={page(<SettingsPage />, admin)} />
        <Route path="model" element={page(<ModelPage />)} />
        <Route path="jobs" element={page(<AdminPages view="jobs" />, admin)} />
        <Route path="audit" element={page(<AdminPages view="audit" />, admin)} />
        <Route path="notifications" element={page(<AccountPages view="notifications" />)} />
        <Route path="profile" element={page(<AccountPages view="profile" />)} />
        <Route path="help" element={page(<AccountPages view="help" />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <EmptyState
      className="min-h-[60vh]"
      title="Page not found"
      description="The address may be mistyped or the page may have moved."
      action={
        <Button variant="secondary" asChild>
          <Link to="/">Go home</Link>
        </Button>
      }
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
            <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
