import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "./views/HomePage";

const ChurchPage = lazy(() =>
  import("./views/ChurchPage").then((m) => ({ default: m.ChurchPage })),
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/churches/:churchSlug",
    element: (
      <Suspense>
        <ChurchPage />
      </Suspense>
    ),
  },
]);
