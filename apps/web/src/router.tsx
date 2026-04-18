import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "./views/HomePage";
import { NotFoundPage } from "./views/NotFoundPage";

const ChurchPage = lazy(() =>
  import("./views/ChurchPage").then((m) => ({ default: m.ChurchPage })),
);

const churchPageFallback = (
  <main className="flex min-h-svh items-center justify-center bg-paper px-4">
    <p className="font-serif text-sm text-ink-soft">Loading…</p>
  </main>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/churches/:churchSlug",
    element: (
      <Suspense fallback={churchPageFallback}>
        <ChurchPage />
      </Suspense>
    ),
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
