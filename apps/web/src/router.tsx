import { lazy, Suspense, type ReactNode } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { LandingPage } from "./views/LandingPage";
import { NotFoundPage } from "./views/NotFoundPage";
import { RequireAuth } from "./auth/RequireAuth";
import { isAboutPageEnabled } from "./lib/featureFlags";
import { isAccountsEnabled, isPaywallEnabled } from "./lib/supabaseEnv";

const HomePage = lazy(() =>
  import("./views/HomePage").then((m) => ({ default: m.HomePage })),
);

const ChurchPage = lazy(() =>
  import("./views/ChurchPage").then((m) => ({ default: m.ChurchPage })),
);

const AboutPage = lazy(() =>
  import("./views/AboutPage").then((m) => ({ default: m.AboutPage })),
);

const SignInPage = lazy(() =>
  import("./views/SignInPage").then((m) => ({ default: m.SignInPage })),
);

const AuthCallbackPage = lazy(() =>
  import("./views/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage })),
);

const AccountPage = lazy(() =>
  import("./views/AccountPage").then((m) => ({ default: m.AccountPage })),
);

// Lazy so the entitlement check — and the Supabase client behind it — is not
// part of the entry bundle.
const RequireAccess = lazy(() => import("./auth/RequireAccess"));

const lazyPageFallback = (
  <main className="flex min-h-svh items-center justify-center bg-paper px-4">
    <p className="font-serif text-sm text-ink-soft">Loading…</p>
  </main>
);

/** Wraps a page in the paywall when one is configured, and leaves it alone
 *  when it is not. */
function gated(page: ReactNode): ReactNode {
  if (!isPaywallEnabled()) {
    return <Suspense fallback={lazyPageFallback}>{page}</Suspense>;
  }
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
// build cannot land anyone on a sign-in page that could never work.
if (isAccountsEnabled()) {
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
        <RequireAuth>
          <Suspense fallback={lazyPageFallback}>
            <AccountPage />
          </Suspense>
        </RequireAuth>
      ),
    },
  );
}

routes.push({
  path: "*",
  element: <NotFoundPage />,
});

export const router = createBrowserRouter(routes);
