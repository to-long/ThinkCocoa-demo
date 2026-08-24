import './index.css';
// Side-effect import: configures the kuana-data-client SDK (baseUrl +
// credentials) before any component renders or issues a request.
import './shared/api/client-config';
import { StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { SWRConfig } from 'swr';
import { TooltipProvider } from '@/components/ui/tooltip';
import { lazyRoute, preloadWhenIdle } from '@/shared/lib/lazy-route';
import App from './App';
import {
  AuthLayout,
  ForgotPasswordForm,
  GuestRoute,
  LandingRoute,
  LoginForm,
  MagicLinkForm,
  ProtectedRoute,
  RequirePermission,
  ResetPasswordForm,
} from './features/auth';
import { ErrorBoundary } from './shared/components/composed/error-boundary';
import { Forbidden } from './shared/components/composed/forbidden';
import { NotFound } from './shared/components/composed/not-found';
import { PageLoader } from './shared/components/composed/page-loader';
import { type Locale, useLocale } from './shared/hooks/use-locale';
import { getCachedMessages, loadMessages } from './shared/intl/messages';
import { initErrorReporting } from './shared/lib/error-reporting';

// ── Lazy route pages ─────────────────────────────────────────────
// Each page is its own chunk (path registered for the post-load warm-up).
// Auth forms stay eager — they are the guest-side first paint.
const DashboardPage = lazyRoute(
  () => import('./features/dashboard/pages/dashboard-page'),
  'DashboardPage',
  '/',
); // prettier-ignore
const FarmersPage = lazyRoute(
  () => import('./features/farmers/pages/farmers-page'),
  'FarmersPage',
  '/farmers',
); // prettier-ignore
const FarmerDetailPage = lazyRoute(
  () => import('./features/farmers/pages/farmer-detail-page'),
  'FarmerDetailPage',
); // prettier-ignore
const FarmsPage = lazyRoute(
  () => import('./features/farms/pages/farms-page'),
  'FarmsPage',
  '/farms',
); // prettier-ignore
const FarmMapPage = lazyRoute(
  () => import('./features/farm-map/pages/farm-map-page'),
  'FarmMapPage',
); // prettier-ignore
const FarmDetailPage = lazyRoute(
  () => import('./features/farms/pages/farm-detail-page'),
  'FarmDetailPage',
); // prettier-ignore
const ClmrsPage = lazyRoute(
  () => import('./features/clmrs/pages/clmrs-page'),
  'ClmrsPage',
  '/clmrs',
); // prettier-ignore
const ClmrsRecordDetailPage = lazyRoute(
  () => import('./features/clmrs/pages/clmrs-record-detail-page'),
  'ClmrsRecordDetailPage',
); // prettier-ignore
const VslaPage = lazyRoute(() => import('./features/vsla/pages/vsla-page'), 'VslaPage', '/vsla'); // prettier-ignore
const VslaDetailPage = lazyRoute(
  () => import('./features/vsla/pages/vsla-detail-page'),
  'VslaDetailPage',
); // prettier-ignore
const InspectionsPage = lazyRoute(
  () => import('./features/inspections/pages/inspections-page'),
  'InspectionsPage',
  '/inspections',
); // prettier-ignore
const InspectionDetailPage = lazyRoute(
  () => import('./features/inspections/pages/inspection-detail-page'),
  'InspectionDetailPage',
); // prettier-ignore
const TrainingPage = lazyRoute(
  () => import('./features/training/pages/training-page'),
  'TrainingPage',
  '/training',
); // prettier-ignore
const TrainingDetailPage = lazyRoute(
  () => import('./features/training/pages/training-detail-page'),
  'TrainingDetailPage',
); // prettier-ignore
const CoachingPage = lazyRoute(
  () => import('./features/coaching/pages/coaching-page'),
  'CoachingPage',
  '/coaching',
); // prettier-ignore
const CoachingDetailPage = lazyRoute(
  () => import('./features/coaching/pages/coaching-detail-page'),
  'CoachingDetailPage',
); // prettier-ignore
const PurchasePage = lazyRoute(
  () => import('./features/purchases/pages/purchase-page'),
  'PurchasePage',
  '/purchases',
); // prettier-ignore
const PurchaseDetailPage = lazyRoute(
  () => import('./features/purchases/pages/purchase-detail-page'),
  'PurchaseDetailPage',
); // prettier-ignore
const PrimaryEvacPage = lazyRoute(
  () => import('./features/primary-evac/pages/primary-evac-page'),
  'PrimaryEvacPage',
  '/primary-evacuation',
); // prettier-ignore
const PrimaryEvacDetailPage = lazyRoute(
  () => import('./features/primary-evac/pages/primary-evac-detail-page'),
  'PrimaryEvacDetailPage',
); // prettier-ignore
const TraceabilityPage = lazyRoute(
  () => import('./features/traceability/pages/traceability-page'),
  'TraceabilityPage',
  '/secondary-evacuation',
); // prettier-ignore
const TraceabilityDetailPage = lazyRoute(
  () => import('./features/traceability/pages/traceability-detail-page'),
  'TraceabilityDetailPage',
); // prettier-ignore
const ExportPage = lazyRoute(
  () => import('./features/export/pages/export-page'),
  'ExportPage',
  '/export',
); // prettier-ignore
const ReportsPage = lazyRoute(
  () => import('./features/reports/pages/reports-page'),
  'ReportsPage',
  '/reports',
); // prettier-ignore
const ProfilePage = lazyRoute(
  () => import('./features/profile/pages/profile-page'),
  'ProfilePage',
  '/profile',
); // prettier-ignore
const AdminUsersPage = lazyRoute(
  () => import('./features/admin/pages/admin-users-page'),
  'AdminUsersPage',
  '/admin/users',
); // prettier-ignore
const AdminUserDetailPage = lazyRoute(
  () => import('./features/admin/pages/admin-user-detail-page'),
  'AdminUserDetailPage',
); // prettier-ignore
const AdminRolesPage = lazyRoute(
  () => import('./features/admin/pages/admin-roles-page'),
  'AdminRolesPage',
  '/admin/roles',
); // prettier-ignore
const AdminPermissionsPage = lazyRoute(
  () => import('./features/admin/pages/admin-permissions-page'),
  'AdminPermissionsPage',
  '/admin/permissions',
); // prettier-ignore
const AdminCooperativesPage = lazyRoute(
  () => import('./features/admin/pages/admin-cooperatives-page'),
  'AdminCooperativesPage',
  '/admin/cooperatives',
); // prettier-ignore
const AdminCooperativeDetailPage = lazyRoute(
  () => import('./features/admin/pages/admin-cooperative-detail-page'),
  'AdminCooperativeDetailPage',
); // prettier-ignore
const AdminSyncPage = lazyRoute(
  () => import('./features/admin/pages/admin-sync-page'),
  'AdminSyncPage',
  '/admin/sync',
); // prettier-ignore
const AdminAuditPage = lazyRoute(
  () => import('./features/admin/pages/admin-audit-page'),
  'AdminAuditPage',
  '/notifications',
); // prettier-ignore
const AdminAuditDetailPage = lazyRoute(
  () => import('./features/admin/pages/admin-audit-detail-page'),
  'AdminAuditDetailPage',
); // prettier-ignore

function Root() {
  const { locale, setLocale } = useLocale();

  // Only the active locale's message chunk is fetched (see
  // ./shared/intl/messages). Keep the last-loaded {locale, messages}
  // pair together so switching language doesn't flash mismatched
  // strings — we hold the previous language until the next chunk lands.
  const [loaded, setLoaded] = useState<{ locale: Locale; messages: Record<string, string> } | null>(
    () => {
      const cached = getCachedMessages(locale);
      return cached ? { locale, messages: cached } : null;
    },
  );

  useEffect(() => {
    let alive = true;
    loadMessages(locale).then((messages) => {
      if (alive) setLoaded({ locale, messages });
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  // Sentry (prod only) is the one thing still warmed from here — route
  // chunks + list data are handled by `route-warmup`, mounted inside the
  // authenticated shell (`App`) so it starts after the current screen has
  // loaded and never fires protected reads on the guest screens.
  useEffect(() => preloadWhenIdle([initErrorReporting]), []);

  // First paint waits on the active locale's message chunk (one small
  // request). A full-viewport spinner covers that brief window.
  if (!loaded) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  return (
    <IntlProvider messages={loaded.messages} locale={loaded.locale} defaultLocale="en">
      <SWRConfig
        value={{
          // Don't re-hit the API every time the tab regains focus — list
          // data is not that volatile and the manual refresh / mutate
          // paths already cover freshness. Dedupe bursts of the same key
          // (e.g. a stat card + its list mounting together) into one call.
          revalidateOnFocus: false,
          dedupingInterval: 5000,
          keepPreviousData: true,
        }}
      >
        <TooltipProvider>
          {/* Global toast surface — used by `useApiErrorToast` for server
            error feedback on mutations. `richColors` opts into the
            tinted error/success/warning variants; `closeButton` adds a
            dismiss affordance for sticky messages. */}
          <Toaster position="top-center" richColors closeButton duration={5000} />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Guest-only routes (redirect to / if logged in) */}
                <Route element={<GuestRoute />}>
                  <Route element={<AuthLayout locale={locale} onLocaleChange={setLocale} />}>
                    <Route path="/login" element={<LoginForm />} />
                    <Route path="/forgot-password" element={<ForgotPasswordForm />} />
                    <Route path="/reset-password" element={<ResetPasswordForm />} />
                    <Route path="/magic-link" element={<MagicLinkForm />} />
                  </Route>
                </Route>

                {/* Protected routes (redirect to /login if not logged in).
                Permission gates live on each route so an unauthorised
                user gets a `Forbidden` page INSIDE the shell — sidebar +
                header stay visible for navigation. `profile` is always
                available to any authenticated user. */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<App locale={locale} onLocaleChange={setLocale} />}>
                    {/* Index (`/`) resolves through LandingRoute: a role
                    WITH `dashboard:read` sees the overview; without it, the
                    user is redirected to the first sidebar page they can
                    read, or a terminal no-access screen if they can read
                    nothing — never a dead 403 at the app's front door. */}
                    <Route
                      index
                      element={
                        <LandingRoute>
                          <DashboardPage />
                        </LandingRoute>
                      }
                    />
                    <Route element={<RequirePermission codes={['farmer:read']} />}>
                      <Route path="farmers" element={<FarmersPage />} />
                      <Route path="farmers/:farmerId" element={<FarmerDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['parcel:read']} />}>
                      <Route path="farms" element={<FarmsPage />} />
                      <Route path="farms/map" element={<FarmMapPage />} />
                      <Route path="farms/:parcelId" element={<FarmDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['clmrs:read']} />}>
                      <Route path="clmrs" element={<ClmrsPage />} />
                      <Route path="clmrs/:childId" element={<ClmrsRecordDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['vsla:read']} />}>
                      <Route path="vsla" element={<VslaPage />} />
                      <Route path="vsla/:id" element={<VslaDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['inspection:read']} />}>
                      <Route path="inspections" element={<InspectionsPage />} />
                      <Route path="inspections/:id" element={<InspectionDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['training:read']} />}>
                      <Route path="training" element={<TrainingPage />} />
                      <Route path="training/:id" element={<TrainingDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['coaching:read']} />}>
                      <Route path="coaching" element={<CoachingPage />} />
                      <Route path="coaching/:id" element={<CoachingDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['purchase:read']} />}>
                      <Route path="purchases" element={<PurchasePage />} />
                      <Route path="purchases/:id" element={<PurchaseDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['primary_evac:read']} />}>
                      <Route path="primary-evacuation" element={<PrimaryEvacPage />} />
                      <Route path="primary-evacuation/:id" element={<PrimaryEvacDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['secondary_evac:read']} />}>
                      <Route path="secondary-evacuation" element={<TraceabilityPage />} />
                      <Route path="secondary-evacuation/:id" element={<TraceabilityDetailPage />} />
                      <Route path="export" element={<ExportPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['report:read']} />}>
                      <Route path="reports" element={<ReportsPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['user:read']} />}>
                      <Route path="admin/users" element={<AdminUsersPage />} />
                      <Route path="admin/users/:userId" element={<AdminUserDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['role:read']} />}>
                      <Route path="admin/roles" element={<AdminRolesPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['permission:read']} />}>
                      <Route path="admin/permissions" element={<AdminPermissionsPage />} />
                    </Route>
                    <Route element={<RequirePermission codes={['cooperative:read']} />}>
                      <Route path="admin/cooperatives" element={<AdminCooperativesPage />} />
                      <Route
                        path="admin/cooperatives/:cooperativeId"
                        element={<AdminCooperativeDetailPage />}
                      />
                    </Route>
                    <Route element={<RequirePermission codes={['sync:config']} />}>
                      <Route path="admin/sync" element={<AdminSyncPage />} />
                    </Route>
                    {/* /notifications gated on ANY `:notification` perm —
                    user qualifies as long as they hold at least one
                    resource's notification eligibility. The page +
                    detail itself filter rows server-side by the
                    user's effective `:notification` set, so the
                    list never leaks audit rows for resources the
                    caller can't subscribe to. */}
                    <Route element={<RequirePermission suffix=":notification" />}>
                      <Route path="notifications" element={<AdminAuditPage />} />
                      <Route path="notifications/:auditLogId" element={<AdminAuditDetailPage />} />
                    </Route>
                    {/* Profile is always available — any authenticated user. */}
                    <Route path="profile" element={<ProfilePage />} />
                    {/* 403 landing — the fetcher hard-redirects here when an
                    API call returns a permission-denied 403. Rendered in
                    the shell so the sidebar stays for navigation. */}
                    <Route path="403" element={<Forbidden />} />
                    {/* Catch-all inside the shell — any unknown URL (e.g.
                    `/farmers1`) renders a 404 with the sidebar intact
                    instead of a blank screen. */}
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </SWRConfig>
    </IntlProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </StrictMode>,
  );
}
