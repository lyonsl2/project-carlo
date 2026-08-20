import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { accountKeys } from "@/api/accountKeys";
import { getSupabaseClient } from "@/lib/supabase";

/** Mirrors the Supabase session into the auth context. Renders nothing.
 *
 *  Split out and loaded lazily so @supabase/supabase-js only reaches the
 *  browser on builds that have accounts switched on.
 */
export default function SupabaseSessionSync({
  onSessionChange,
}: {
  onSessionChange: (session: Session | null) => void;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;
    let currentUserId: string | null = null;

    // getSession resolves from storage, and also completes the PKCE exchange
    // when the page was opened from a magic link.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      currentUserId = data.session?.user.id ?? null;
      onSessionChange(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUserId = session?.user.id ?? null;
      // Signing out — or signing in as someone else on a shared machine — must
      // not leave the previous account's rows in the query cache.
      if (nextUserId !== currentUserId) {
        queryClient.removeQueries({ queryKey: accountKeys.all });
      }
      currentUserId = nextUserId;
      onSessionChange(session);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [onSessionChange, queryClient]);

  return null;
}
