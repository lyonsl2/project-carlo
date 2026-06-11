import { useEffect } from "react";

/**
 * Keeps the document head in sync with the active client-rendered route.
 *
 * The static shell (`index.html`) and prerendered church pages already ship
 * correct head tags for crawlers; this hook updates them after client-side
 * navigation so browser tabs, bookmarks, shared links, and the canonical URL
 * stay accurate (and fixes the shell's hardcoded canonical leaking onto other
 * SPA routes). It upserts existing tags rather than appending duplicates, and
 * removes tags whose value is omitted so nothing stale survives navigation.
 */
interface DocumentMeta {
  title: string;
  description?: string;
  /** Absolute canonical URL. Omit on pages that should not be canonicalized. */
  canonicalUrl?: string;
  /** When true, emit `<meta name="robots" content="noindex">` (e.g. 404s). */
  noindex?: boolean;
}

function setMeta(selector: string, create: () => HTMLElement, content: string | undefined): void {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (content === undefined) {
    el?.remove();
    return;
  }
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaByName(name: string, content: string | undefined): void {
  setMeta(
    `meta[name="${name}"]`,
    () => {
      const el = document.createElement("meta");
      el.setAttribute("name", name);
      return el;
    },
    content,
  );
}

function setMetaByProperty(property: string, content: string | undefined): void {
  setMeta(
    `meta[property="${property}"]`,
    () => {
      const el = document.createElement("meta");
      el.setAttribute("property", property);
      return el;
    },
    content,
  );
}

function setCanonical(href: string | undefined): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === undefined) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function useDocumentMeta({
  title,
  description,
  canonicalUrl,
  noindex = false,
}: DocumentMeta): void {
  useEffect(() => {
    document.title = title;
    setMetaByProperty("og:title", title);
    setMetaByName("twitter:title", title);

    setMetaByName("description", description);
    setMetaByProperty("og:description", description);
    setMetaByName("twitter:description", description);

    setCanonical(canonicalUrl);
    setMetaByProperty("og:url", canonicalUrl);

    // Always set robots so navigating away from a noindex route restores it.
    setMetaByName("robots", noindex ? "noindex" : "index, follow");
  }, [title, description, canonicalUrl, noindex]);
}
