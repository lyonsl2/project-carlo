import { useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { sendMagicLink, signInWithGoogle } from "@/auth/authActions";
import { ArrowLeftIcon } from "@/components/icons";
import { Masthead } from "@/components/Masthead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useHomeHref } from "@/hooks/useHomeHref";
import { safeNextPath } from "@/lib/nextPath";
import { TRIAL_PERIOD_DAYS } from "@/lib/plans";
import { isGoogleSignInEnabled, isPaywallEnabled } from "@/lib/supabaseEnv";

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "sent"; email: string };

export function SignInPage() {
  useDocumentMeta({ title: "Sign in · Project Carlo", noindex: true });

  const { status } = useAuth();
  const homeHref = useHomeHref();
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const paywalled = isPaywallEnabled();

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);

  if (status === "signedIn") {
    return <Navigate to={nextPath} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setPhase({ kind: "sending" });
    setError(null);
    try {
      await sendMagicLink(trimmed, nextPath);
      setPhase({ kind: "sent", email: trimmed });
    } catch (cause) {
      setPhase({ kind: "form" });
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn't send that link. Please try again.",
      );
    }
  }

  async function onGoogle() {
    setError(null);
    try {
      await signInWithGoogle(nextPath);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "We couldn't reach Google. Try email.",
      );
    }
  }

  return (
    <main className="min-h-svh bg-paper px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[28rem] flex-col gap-8">
        <header className="space-y-4">
          <Link to={homeHref} className="rubric-link smallcaps text-[0.875rem]">
            <ArrowLeftIcon className="size-3" />
            Back to map
          </Link>
          <Masthead compact />
        </header>

        {phase.kind === "sent" ? (
          <section className="space-y-3">
            <h1 className="font-display text-[2rem] leading-[1.1] text-ink">
              Check your email
            </h1>
            <p className="font-serif text-base text-ink-soft">
              We sent a sign-in link to <strong>{phase.email}</strong>. Open it on
              this device and you&apos;ll be signed in — there is no password to
              remember.
            </p>
            <button
              type="button"
              onClick={() => setPhase({ kind: "form" })}
              className="rubric-link smallcaps text-[0.875rem]"
            >
              Use a different address
            </button>
          </section>
        ) : (
          <section className="space-y-5">
            <div className="space-y-3">
              <h1 className="font-display text-[2rem] leading-[1.1] text-ink">
                Sign in
              </h1>
              <p className="font-serif text-base text-ink-soft">
                {paywalled
                  ? `We'll email you a link — no password to remember. New here? Signing in starts your free ${TRIAL_PERIOD_DAYS}-day trial, and we won't ask for a card until it ends.`
                  : "An account lets you keep a list of parishes and carry it between your phone and your desk."}
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <Label htmlFor="signin-email" className="smallcaps text-[0.8rem]">
                Email address
              </Label>
              <Input
                id="signin-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
              <Button type="submit" disabled={phase.kind === "sending"}>
                {phase.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
              </Button>
            </form>

            {isGoogleSignInEnabled() ? (
              <div className="space-y-3">
                <hr className="hairline" />
                <Button type="button" variant="outline" onClick={onGoogle}>
                  Continue with Google
                </Button>
              </div>
            ) : null}

            {error ? (
              <p className="font-serif text-sm text-rubric" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
