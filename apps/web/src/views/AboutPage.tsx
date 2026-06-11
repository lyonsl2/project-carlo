import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@/components/icons";
import { Masthead } from "@/components/Masthead";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { canonicalForPath } from "@/lib/seo";

export function AboutPage() {
  useDocumentMeta({
    title: "About · Project Carlo",
    description:
      "About Project Carlo — a directory of Catholic parishes with Mass, Confession, and Adoration times parsed from weekly bulletins.",
    canonicalUrl: canonicalForPath("/about"),
  });

  return (
    <main className="min-h-svh bg-paper px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-8">
        <header className="space-y-4">
          <Link to="/" className="rubric-link smallcaps text-[0.875rem]">
            <ArrowLeftIcon className="size-3" />
            Back to map
          </Link>
          <Masthead compact />
        </header>

        <section className="space-y-3">
          <h1 className="font-display text-[2rem] leading-[1.1] text-ink sm:text-[2.5rem]">
            About
          </h1>
          <p className="font-serif text-base text-ink-soft">
            Placeholder intro paragraph. Replace this copy with a short
            description of what Project Carlo is and who it's for.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="smallcaps text-[0.875rem] text-ink">What this is</h2>
          <p className="font-serif text-base text-ink-soft">
            Placeholder body. Lorem ipsum dolor sit amet, consectetur adipiscing
            elit. Replace with a paragraph or two explaining the project's
            purpose.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="smallcaps text-[0.875rem] text-ink">Why we built it</h2>
          <p className="font-serif text-base text-ink-soft">
            Placeholder body. Describe the motivation behind the project — what
            problem it solves and who benefits.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="smallcaps text-[0.875rem] text-ink">Get in touch</h2>
          <p className="font-serif text-base text-ink-soft">
            Placeholder body. Add contact details, social links, or a feedback
            call-to-action here.
          </p>
        </section>
      </div>
    </main>
  );
}
