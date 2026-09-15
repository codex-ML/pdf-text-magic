import type { PageState } from "@/lib/pdf/types";
import { ChevronUp, ChevronDown, Copy, RotateCw, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  pages: PageState[];
  current: number;
  onGo: (i: number) => void;
  onChange: (pages: PageState[]) => void;
}

export function PagesRail({ pages, current, onGo, onChange }: Props) {
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= pages.length) return;
    const next = [...pages];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    onChange(next);
  };

  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Pages
        </span>
        <Button
          variant="ghost"
          size="icon"
          title="Insert a copy of the current page"
          onClick={() => {
            const ref = pages[current] ?? pages[0];
            if (!ref) return;
            const next = [...pages];
            next.splice(current + 1, 0, { ...ref, rotation: 0 });
            onChange(next);
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {pages.map((p, i) => (
          <div
            key={`${p.sourceIndex}-${i}`}
            className={`rounded-md border p-2 transition-colors ${
              i === current ? "border-primary bg-accent" : "border-border bg-card hover:bg-accent/50"
            }`}
          >
            <button
              onClick={() => onGo(i)}
              className="flex w-full items-center gap-2 text-left text-sm font-medium"
            >
              <span
                className="grid h-10 w-8 shrink-0 place-items-center rounded-sm border border-border bg-background text-[10px] text-muted-foreground"
                style={{ transform: `rotate(${p.rotation}deg)` }}
              >
                {i + 1}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {Math.round(p.width)}×{Math.round(p.height)} pt
              </span>
            </button>
            <div className="mt-1 flex gap-0.5">
              <Button variant="ghost" size="icon" title="Move up" onClick={() => swap(i, i - 1)}>
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" title="Move down" onClick={() => swap(i, i + 1)}>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Rotate"
                onClick={() => {
                  const next = [...pages];
                  next[i] = { ...p, rotation: (p.rotation + 90) % 360 };
                  onChange(next);
                }}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Duplicate"
                onClick={() => {
                  const next = [...pages];
                  next.splice(i + 1, 0, { ...p });
                  onChange(next);
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Delete"
                disabled={pages.length === 1}
                onClick={() => onChange(pages.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
