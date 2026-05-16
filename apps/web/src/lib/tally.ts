const WIDGET_SRC = "https://tally.so/widgets/embed.js";

interface TallyPopupOptions {
  layout?: "default" | "modal";
  overlay?: boolean;
  hideTitle?: boolean;
  hiddenFields?: Record<string, string>;
}

declare global {
  interface Window {
    Tally?: {
      openPopup: (formId: string, options?: TallyPopupOptions) => void;
      closePopup: (formId: string) => void;
      loadEmbeds: () => void;
    };
  }
}

let loadPromise: Promise<void> | null = null;

function loadTallyWidget(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.Tally) {
    return Promise.resolve();
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${WIDGET_SRC}"]`,
    );
    if (existing) {
      if (window.Tally) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Tally widget")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Tally widget"));
    document.body.appendChild(script);
  });

  return loadPromise;
}

/** Published Tally form ID from Share → popup/embed URLs. */
export function getTallyFormId(): string | undefined {
  const id = import.meta.env.VITE_TALLY_FORM_ID?.trim();
  return id || undefined;
}

export async function openFeedbackPopup(
  hiddenFields: Record<string, string>,
): Promise<void> {
  const formId = getTallyFormId();
  if (!formId) {
    return;
  }

  await loadTallyWidget();
  window.Tally?.openPopup(formId, {
    layout: "modal",
    overlay: true,
    hiddenFields,
  });
}
