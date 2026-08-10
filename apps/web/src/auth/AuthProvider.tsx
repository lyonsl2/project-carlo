import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ACCOUNTS_ENABLED } from "@/lib/supabaseEnv";
import { AuthContext, SIGNED_OUT, type AuthState } from "./AuthContext";

function toAuthState(session: Session | null): AuthState {
  if (!session) return SIGNED_OUT;
  return { status: "signedIn", session, user: session.user };
}

/** Publishes the current Supabase session to the tree.
 *
 *  Always mounted, even with accounts switched off, so nothing downstream has
 *  to branch on whether the provider exists — it simply reports signed out.
 *  With accounts off the enabled branch never renders, so SupabaseSessionSync
 *  is never imported and the Supabase client never reaches the browser.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!ACCOUNTS_ENABLED) {
    return <AuthContext value={SIGNED_OUT}>{children}</AuthContext>;
  }
  return <AuthProviderEnabled>{children}</AuthProviderEnabled>;
}

function AuthProviderEnabled({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    session: null,
    user: null,
  });

  const onSessionChange = useCallback((session: Session | null) => {
    setState(toAuthState(session));
  }, []);

  return (
    <AuthContext value={state}>
      <Suspense fallback={null}>
        <SupabaseSessionSync onSessionChange={onSessionChange} />
      </Suspense>
      {children}
    </AuthContext>
  );
}

const SupabaseSessionSync = lazy(() => import("./SupabaseSessionSync"));
