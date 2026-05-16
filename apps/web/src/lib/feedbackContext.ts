/** Context attached to each Tally submission via hidden fields. */
export interface FeedbackContext extends Record<string, string> {
  page_path: string;
  full_url: string;
  church_slug: string;
  church_name: string;
}

export function buildFeedbackContext(church?: {
  slug: string;
  name: string | null;
}): FeedbackContext {
  return {
    page_path: window.location.pathname,
    full_url: window.location.href,
    church_slug: church?.slug ?? "",
    church_name: church?.name ?? "",
  };
}
