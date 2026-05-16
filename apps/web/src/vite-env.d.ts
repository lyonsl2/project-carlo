/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOAPIFY_API_KEY?: string;
  readonly VITE_TALLY_FORM_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
