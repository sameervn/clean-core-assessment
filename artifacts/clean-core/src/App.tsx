import { lazy, Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2, WifiOff } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { YashLogo } from '@/components/yash-logo';
import NotFound from '@/pages/not-found';
import WorkspaceRoute from '@/pages/workspace';
import LoginPage from '@/pages/login';
import ChangePasswordPage from '@/pages/change-password';
import AdminUsersPage from '@/pages/admin-users';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const KnowledgePage = lazy(() => import('@/pages/knowledge'));
const ReportTemplatesPage = lazy(() => import('@/pages/report-templates'));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function VoluntaryPasswordChange() {
  const [, navigate] = useLocation();
  return <ChangePasswordPage forced={false} onCancel={() => navigate('/')} />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={WorkspaceRoute} />
        <Route path="/admin" component={AdminUsersPage} />
        <Route path="/account/password" component={VoluntaryPasswordChange} />
        <Route path="/knowledge">
          <Suspense fallback={<div className="flex min-h-[100dvh] items-center justify-center bg-[#f3f6f9]" data-testid="status-loading-knowledge"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}>
            <KnowledgePage />
          </Suspense>
        </Route>
        <Route path="/report-templates">
          <Suspense fallback={<div className="flex min-h-[100dvh] items-center justify-center bg-[#f3f6f9]" data-testid="status-loading-templates-page"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}>
            <ReportTemplatesPage />
          </Suspense>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/** Nothing below renders without an authenticated, active session. */
function AuthGate() {
  const { state, refresh, signature } = useAuth();
  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#f3f6f9]" data-testid="status-checking-session">
        <YashLogo />
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#f3f6f9] p-6 text-center" data-testid="status-session-error">
        <YashLogo />
        <WifiOff className="h-6 w-6 text-slate-400" />
        <p className="max-w-sm text-sm text-slate-600">{state.message}</p>
        <Button variant="outline" onClick={() => void refresh()} data-testid="button-retry-session">Try again</Button>
      </div>
    );
  }
  if (state.status === 'anonymous') return <LoginPage setupRequired={state.setupRequired} notice={state.notice} />;
  if (state.user.mustChangePassword) return <ChangePasswordPage forced />;
  // Remount the routed tree on any identity/permission change.
  return <Router key={signature} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthGate />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
