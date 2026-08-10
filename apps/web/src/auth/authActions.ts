import { getSupabaseClient } from "@/lib/supabase";
import { safeNextPath } from "@/lib/nextPath";

export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Where Supabase should send the browser back to. The destination rides along
 *  as a query parameter because the session does not exist yet, so there is
 *  nowhere else to keep it. */
export function buildCallbackUrl(origin: string, nextPath: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", safeNextPath(nextPath));
  return url.toString();
}

export async function sendMagicLink(email: string, nextPath: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: buildCallbackUrl(window.location.origin, nextPath),
      shouldCreateUser: true,
    },
  });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle(nextPath: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: buildCallbackUrl(window.location.origin, nextPath) },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw new Error(error.message);
}
