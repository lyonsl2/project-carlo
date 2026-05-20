import { lazy, Suspense } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { LandingPage } from "./views/LandingPage";
import { NotFoundPage } from "./views/NotFoundPage";
import { isAboutPageEnabled } from "./lib/featureFlags";

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

routes.push({
  path: "*",
  element: <NotFoundPage />,
});

export const router = createBrowserRouter(routes);
