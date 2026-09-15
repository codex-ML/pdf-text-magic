import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const PdfEditor = lazy(() => import("@/components/editor/PdfEditor"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Inkline — Real-text PDF Editor in Your Browser" },
      {
        name: "description",
        content:
          "Edit existing PDF text in place, add images, signatures and shapes, and reorder pages. Files never leave your device.",
      },
      { property: "og:title", content: "Inkline — Real-text PDF Editor" },
      {
        property: "og:description",
        content:
          "Retype paragraphs directly inside a PDF, sign, annotate and rearrange pages — fully offline in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Loading editor…</div>}>
      <Suspense
        fallback={
          <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
            Loading editor…
          </div>
        }
      >
        <PdfEditor />
      </Suspense>
    </ClientOnly>
  );
}
