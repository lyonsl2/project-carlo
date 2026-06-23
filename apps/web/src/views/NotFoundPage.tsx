import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "@/components/icons";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useHomeHref } from "@/hooks/useHomeHref";

interface NotFoundPageProps {
  title?: string;
  message?: string;
}

export function NotFoundPage({
  title = "Page not found",
  message = "We couldn't find what you were looking for.",
}: NotFoundPageProps) {
  useDocumentMeta({ title: `${title} · Project Carlo`, noindex: true });
  const homeHref = useHomeHref();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-paper px-4 py-8 text-center">
      <h1 className="font-display text-[1.5rem] leading-[1.1] text-ink">
        {title}
      </h1>
      <p className="max-w-md font-serif text-base text-ink-soft">{message}</p>
      <Link to={homeHref} className="rubric-link smallcaps text-[0.875rem]">
        <ArrowLeftIcon className="size-3" />
        Back to map
      </Link>
    </main>
  );
}
