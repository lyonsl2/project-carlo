import { useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buildFeedbackContext } from "@/lib/feedbackContext";
import { getTallyFormId, openFeedbackPopup } from "@/lib/tally";

interface FeedbackTriggerProps {
  /** Shown on church pages so the parish is attached to the submission. */
  church?: { slug: string; name: string | null };
  label?: string;
  icon?: ReactNode;
  variant?: "link" | "pill";
  className?: string;
}

/** Opens the Tally feedback popup with page and parish context. */
export function FeedbackTrigger({
  church,
  label = "Share feedback",
  icon,
  variant = "link",
  className,
}: FeedbackTriggerProps) {
  const formId = getTallyFormId();

  const handleClick = useCallback(() => {
    const context = buildFeedbackContext(church);
    void openFeedbackPopup(context);
  }, [church]);

  if (!formId) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        variant === "pill"
          ? "rubric-link smallcaps inline-flex items-center gap-2 text-[0.875rem]"
          : "rubric-link smallcaps text-[0.875rem] text-rubric hover:text-rubric-deep",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
