/** Build-time feature flags driven by Vite env vars. Inlined by Vite, so
 *  disabled features tree-shake out of the production bundle. */

export function isAboutPageEnabled(): boolean {
  const v = import.meta.env.VITE_ABOUT_PAGE_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1";
}
