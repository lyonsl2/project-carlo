import { useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accountKeys,
  fetchSavedChurchSlugs,
  saveChurch,
  unsaveChurch,
} from "@/api/account";
import { useAuth } from "@/auth/AuthContext";
import { BookmarkIcon } from "@/components/icons";
import { AccessRequiredError } from "@/lib/accountErrors";
import { isAccountsEnabled } from "@/lib/supabaseEnv";

const TRIGGER_CLASS =
  "rubric-link smallcaps inline-flex items-center gap-2 text-[0.875rem]";

/** Save/unsave toggle for a parish.
 *
 *  Rendered only from the interactive church route: the prerendered church
 *  pages ship without JavaScript, so a button there would be decoration. */
export function SaveChurchButton({ slug }: { slug: string }) {
  const { status, user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const signedIn = status === "signedIn" && user !== null;

  const savedQuery = useQuery({
    queryKey: accountKeys.savedChurches(),
    queryFn: fetchSavedChurchSlugs,
    enabled: signedIn,
  });

  const isSaved = savedQuery.data?.includes(slug) ?? false;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (isSaved) {
        await unsaveChurch(user.id, slug);
      } else {
        await saveChurch(user.id, slug);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    },
  });

  const onClick = useCallback(() => mutation.mutate(), [mutation]);

  if (!isAccountsEnabled()) return null;

  if (!signedIn) {
    const next = `${location.pathname}${location.search}`;
    return (
      <Link to={`/signin?next=${encodeURIComponent(next)}`} className={TRIGGER_CLASS}>
        <BookmarkIcon className="size-3" />
        Save this parish
      </Link>
    );
  }

  const needsAccess = mutation.error instanceof AccessRequiredError;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={mutation.isPending || savedQuery.isLoading}
        aria-pressed={isSaved}
        className={`${TRIGGER_CLASS} disabled:opacity-50`}
      >
        <BookmarkIcon className="size-3" filled={isSaved} />
        {isSaved ? "Saved" : "Save this parish"}
      </button>
      {needsAccess ? (
        <span className="font-serif text-[0.8rem] italic text-ink-faint">
          Your trial has ended.{" "}
          <Link to="/account" className="rubric-link">
            Subscribe
          </Link>{" "}
          to keep saving parishes.
        </span>
      ) : null}
      {mutation.error && !needsAccess ? (
        <span className="font-serif text-[0.8rem] italic text-rubric">
          That didn&apos;t save. Please try again.
        </span>
      ) : null}
    </span>
  );
}
