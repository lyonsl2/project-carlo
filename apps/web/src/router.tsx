import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { LandingPage } from "./views/LandingPage";
import { NotFoundPage } from "./views/NotFoundPage";
import { RequireAuth } from "./auth/RequireAuth";
import { isAboutPageEnabled } from "./lib/featureFlags";
import { isAccountsEnabled } from "./lib/supabaseEnv";

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

const lazyPageFallback = (
  <main className="flex min-h-svh items-center justify-center bg-paper px-4">
    <p className="font-serif text-sm text-ink-soft">Loading…</p>
  </main>
);

const routes: RouteObject[] = [
  {
    path: "/",
    element: (
      <Suspense fallback={lazyPageFallback}>
        <HomePage />
      </Suspense>
    ),
  },
  {
    path: "/landing",
    element: <LandingPage />,
  },
  {
    path: "/map",
    element: <Navigate to="/" replace />,
  },
  {
    path: "/churches/:churchSlug",
    element: (
      <Suspense fallback={lazyPageFallback}>
        <ChurchPage />
      </Suspense>
    ),
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
