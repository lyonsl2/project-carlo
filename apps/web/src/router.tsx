import { lazy, Suspense, type ReactNode } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { LandingPage } from "./views/LandingPage";
import { NotFoundPage } from "./views/NotFoundPage";
import { isAboutPageEnabled } from "./lib/featureFlags";
import { ACCOUNTS_ENABLED, PAYWALL_ENABLED } from "./lib/supabaseEnv";

const HomePage = lazy(() =>
  import("./views/HomePage").then((m) => ({ default: m.HomePage })),
);

const ChurchPage = lazy(() =>
  import("./views/ChurchPage").then((m) => ({ default: m.ChurchPage })),
);

const AboutPage = lazy(() =>
  import("./views/AboutPage").then((m) => ({ default: m.AboutPage })),
);

const lazyPageFallback = (
  <main className="flex min-h-svh items-center justify-center bg-paper px-4">
    <p className="font-serif text-sm text-ink-soft">Loading…</p>
  </main>
);

/** Wraps a page in the paywall when one is configured, and leaves it alone
 *  when it is not. Account-only imports stay inside this branch so accounts-off
 *  builds never pull in RequireAccess / the Supabase client. */
function gated(page: ReactNode): ReactNode {
  if (!PAYWALL_ENABLED) {
    return <Suspense fallback={lazyPageFallback}>{page}</Suspense>;
  }
  const RequireAccess = lazy(() => import("./auth/RequireAccess"));
  return (
    <Suspense fallback={lazyPageFallback}>
      <RequireAccess>{page}</RequireAccess>
    </Suspense>
  );
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: gated(<HomePage />),
  },
  {
    // The public face of the site: the only content page that stays reachable
    // without an account, and where the trial is offered.
    path: "/landing",
    element: <LandingPage />,
  },
  {
    path: "/map",
    element: <Navigate to="/" replace />,
  },
  {
    path: "/churches/:churchSlug",
    element: gated(<ChurchPage />),
  },
];

if (isAboutPageEnabled()) {
  routes.push({
    path: "/about",
    element: (
      <Suspense fallback={lazyPageFallback}>
        <AboutPage />
      </Suspense>
    ),
  });
}

// Without a Supabase project these routes do not exist, so an unconfigured
// build cannot land anyone on a sign-in page that could never work — and with
// no route to reach them, the lazy imports below are never fetched.
if (ACCOUNTS_ENABLED) {
  const SignInPage = lazy(() =>
    import("./views/SignInPage").then((m) => ({ default: m.SignInPage })),
  );
  const AuthCallbackPage = lazy(() =>
    import("./views/AuthCallbackPage").then((m) => ({
      default: m.AuthCallbackPage,
    })),
  );
  const AccountPage = lazy(() =>
    import("./views/AccountPage").then((m) => ({ default: m.AccountPage })),
  );
  const RequireAuth = lazy(() =>
    import("./auth/RequireAuth").then((m) => ({ default: m.RequireAuth })),
  );

  routes.push(
    {
      path: "/signin",
      element: (
        <Suspense fallback={lazyPageFallback}>
          <SignInPage />
        </Suspense>
      ),
    },
    {
      path: "/auth/callback",
      element: (
        <Suspense fallback={lazyPageFallback}>
          <AuthCallbackPage />
        </Suspense>
      ),
    },
    {
      // Deliberately behind sign-in but not behind the paywall: this is where
      // someone whose trial has ended goes to subscribe.
      path: "/account",
      element: (
        <Suspense fallback={lazyPageFallback}>
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        </Suspense>
      ),
    },
  );
}

routes.push({
  path: "*",
  element: <NotFoundPage />,
});

export const router = createBrowserRouter(routes);
