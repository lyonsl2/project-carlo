/** Supabase clients for edge functions.
 *
 *  Two are needed and they are not interchangeable:
 *
 *  - the service client bypasses RLS and is the only thing allowed to write
 *    billing tables; it must never be handed a value that came from the client
 *    without checking it first;
 *  - the request client carries the caller's JWT and is used purely to find out
 *    who they are.
 */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { requireEnv } from "./env.ts";
import { HttpError } from "./http.ts";

/** SUPABASE_URL and the key variables are injected into every deployed
 *  function; they do not need to be set as secrets. */
export function createServiceClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function requireUser(req: Request): Promise<User> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "unauthorized", "Sign in to continue.");
  }

  const client = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    },
  );

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "unauthorized", "Your session has expired. Sign in again.");
  }
  return data.user;
}
