import { createBrowserRouter } from "react-router-dom";
import { HomePage } from "./views/HomePage";
import { ChurchPage } from "./views/ChurchPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/churches/:churchSlug",
    element: <ChurchPage />,
  },
]);
