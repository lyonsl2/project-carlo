import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { HomePage } from "./views/HomePage";
import { NotFoundPage } from "./views/NotFoundPage";
import { isAboutPageEnabled } from "./lib/featureFlags";

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
    element: <HomePage />,
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
