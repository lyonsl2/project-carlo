import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";

/** Gate for the account routes.
 *
 *  This is a convenience, not a security control: every row it protects is also
 *  protected by row level security, so a user who forces their way past the
 *  redirect still sees nothing.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <main className="flex min-h-svh items-center justify-center bg-paper px-4">
        <p className="font-serif text-sm text-ink-soft">Loading…</p>
      </main>
    );
  }

  if (status === "signedOut") {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/signin?next=${encodeURIComponent(next)}`} replace />;
  }

  return <>{children}</>;
}
