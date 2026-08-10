import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "./supabaseEnv";

let client: SupabaseClient<Database> | null = null;

/** The Supabase client, created on first use.
 *
 *  Lazy because importing this module must stay side-effect free: the prerender
 *  loads app components in Node, where there is no localStorage for the auth
 *  client to attach to. */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (client) return client;

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }

  client = createClient<Database>(url, anonKey, {
    auth: {
      // PKCE keeps the token exchange off the URL fragment, which matters for a
      // static site where the redirect lands on a plain HTML document.
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}
