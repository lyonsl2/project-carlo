/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOAPIFY_API_KEY?: string;
  readonly VITE_TALLY_FORM_ID?: string;
  readonly VITE_ABOUT_PAGE_ENABLED?: string;
  /** Accounts and billing switch themselves off unless both of these are set. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_AUTH_GOOGLE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
