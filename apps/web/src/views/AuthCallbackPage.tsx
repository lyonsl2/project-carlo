import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { safeNextPath } from "@/lib/nextPath";

/** Where magic links and OAuth round trips land.
 *
 *  The Supabase client does the actual work — it spots the code in the URL and
 *  exchanges it for a session — so this page only has to wait for the auth
 *  state to settle and then get out of the way.
 */
const GIVE_UP_AFTER_MS = 15_000;

export function AuthCallbackPage() {
  useDocumentMeta({ title: "Signing you in · Project Carlo", noindex: true });

  const { status } = useAuth();
  const [searchParams] = useSearchParams();
  const [timedOut, setTimedOut] = useState(false);

  const nextPath = safeNextPath(searchParams.get("next"));
  // Supabase reports a refused or expired link as query parameters on the
  // redirect rather than by failing the exchange.
  const authError =
    searchParams.get("error_description") ?? searchParams.get("error");

  useEffect(() => {
    if (authError) return;
    const timer = window.setTimeout(() => setTimedOut(true), GIVE_UP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [authError]);

  if (status === "signedIn") {
    return <Navigate to={nextPath} replace />;
  }

  // A signed-out state here means the exchange finished and produced nothing,
  // which is what an already-used link looks like.
  const failed = Boolean(authError) || timedOut || status === "signedOut";

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-paper px-4 py-8 text-center">
      {failed ? (
        <>
          <h1 className="font-display text-[1.5rem] leading-[1.1] text-ink">
            That link didn&apos;t work
          </h1>
          <p className="max-w-md font-serif text-base text-ink-soft">
            {authError ??
              "Sign-in links can only be used once, and they expire. Ask for a fresh one."}
          </p>
          <Link
            to={`/signin?next=${encodeURIComponent(nextPath)}`}
            className="rubric-link smallcaps text-[0.875rem]"
          >
            Try again
          </Link>
        </>
      ) : (
        <p className="font-serif text-sm text-ink-soft">Signing you in…</p>
      )}
    </main>
  );
}
