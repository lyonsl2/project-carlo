import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isAccountsEnabled } from "@/lib/supabaseEnv";
import { AuthContext, SIGNED_OUT, type AuthState } from "./AuthContext";

const SupabaseSessionSync = lazy(() => import("./SupabaseSessionSync"));

function toAuthState(session: Session | null): AuthState {
  if (!session) return SIGNED_OUT;
  return { status: "signedIn", session, user: session.user };
}

/** Publishes the current Supabase session to the tree.
 *
 *  Always mounted, even with accounts switched off, so nothing downstream has
 *  to branch on whether the provider exists — it simply reports signed out. The
 *  part that talks to Supabase is a lazily loaded child, which keeps the client
 *  library out of builds that will never use it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const accountsEnabled = isAccountsEnabled();
  const [state, setState] = useState<AuthState>(() =>
    accountsEnabled ? { status: "loading", session: null, user: null } : SIGNED_OUT,
  );

  const onSessionChange = useCallback((session: Session | null) => {
    setState(toAuthState(session));
  }, []);

  return (
    <AuthContext value={state}>
      {accountsEnabled ? (
        <Suspense fallback={null}>
          <SupabaseSessionSync onSessionChange={onSessionChange} />
        </Suspense>
      ) : null}
      {children}
    </AuthContext>
  );
}
