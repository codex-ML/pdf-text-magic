import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FilePlus2,
  Highlighter,
  ImageIcon,
  Minus,
  MousePointer2,
  PenTool,
  Redo2,
  Square,
  Circle,
  Eraser,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  Trash2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { loadDocument } from "@/lib/pdf/load";
import { buildPdf } from "@/lib/pdf/export";
import { FONT_KEYS } from "@/lib/pdf/fonts";
import type { Annotation, FontKey } from "@/lib/pdf/types";
import { useEditor, type Tool } from "@/lib/pdf/useEditor";
import { PageCanvas } from "./PageCanvas";
import { PagesRail } from "./PagesRail";
import { cn } from "@/lib/utils";

const TOOLS: { id: Tool; icon: typeof Type; label: string }[] = [
  { id: "select", icon: MousePointer2, label: "Edit text" },
  { id: "text", icon: Type, label: "Add text" },
  { id: "image", icon: ImageIcon, label: "Image" },
  { id: "ink", icon: PenTool, label: "Draw / sign" },
  { id: "highlight", icon: Highlighter, label: "Highlight" },
  { id: "whiteout", icon: Eraser, label: "Whiteout" },
  { id: "rect", icon: Square, label: "Rectangle" },
  { id: "ellipse", icon: Circle, label: "Ellipse" },
  { id: "line", icon: Minus, label: "Line" },
];

export default function PdfEditor() {
  const editor = useEditor();
  const { doc } = editor;
  const [tool, setTool] = useState<Tool>("select");
  const [scale, setScale] = useState(1.25);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(0);
  const [sel, setSel] = useState<{ id: string; type: "block" | "annotation" } | null>(null);
  const [style, setStyle] = useState({
    color: "#111111",
    fill: "#ffe066",
    fontKey: "Helvetica" as FontKey,
    size: 14,
    strokeWidth: 1.5,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const imgCb = useRef<((d: string, t: "png" | "jpg") => void) | null>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const openFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const parsed = await loadDocument(file);
        editor.load(parsed);
        const locked = parsed.blocks.filter((b) => !b.editable).length;
        toast.success(
          `${file.name} opened — ${parsed.pages.length} page${parsed.pages.length > 1 ? "s" : ""}, ${parsed.blocks.length} text lines`,
          locked ? { description: `${locked} lines use a font we can't reproduce exactly and stay locked.` } : undefined,
        );
      } catch {
        toast.error("That file could not be opened as a PDF.");
      } finally {
        setBusy(false);
      }
    },
    [editor],
  );

  const download = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const bytes = await buildPdf(doc);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.fileName}-edited.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Saved to your downloads.");
    } catch {
      toast.error("Could not build the edited file.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? editor.redo() : editor.undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && sel?.type === "annotation") {
        editor.removeAnnotation(sel.id);
        setSel(null);
      }
      if (e.key === "Escape") setTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, sel]);

  const selectedBlock = doc?.blocks.find((b) => b.id === sel?.id && sel?.type === "block");
  const selectedAnn = doc?.annotations.find((a) => a.id === sel?.id && sel?.type === "annotation");

  return (
    <div className="flex h-screen flex-col bg-background">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={imgRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && imgCb.current) {
            const reader = new FileReader();
            const type = f.type === "image/png" ? "png" : "jpg";
            reader.onload = () => imgCb.current?.(String(reader.result), type);
            reader.readAsDataURL(f);
          }
          e.target.value = "";
        }}
      />

      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <span className="font-display text-xl tracking-tight text-foreground">Inkline</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Real-text PDF editing, entirely in your browser
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" /> Open
          </Button>
          <Button size="sm" disabled={!doc || busy} onClick={download}>
            <Download className="mr-1.5 h-4 w-4" /> Download
          </Button>
        </div>
      </header>

      {!doc ? (
        <Dropzone busy={busy} onPick={() => fileRef.current?.click()} onFile={openFile} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <PagesRail
            pages={doc.pages}
            current={current}
            onGo={(i) => {
              setCurrent(i);
              pageRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onChange={(pages) => editor.setPages(pages)}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-2">
              {TOOLS.map((t) => (
                <Button
                  key={t.id}
                  variant={tool === t.id ? "default" : "ghost"}
                  size="sm"
                  title={t.label}
                  onClick={() => setTool(t.id)}
                >
                  <t.icon className="h-4 w-4" />
                  <span className="ml-1.5 hidden xl:inline">{t.label}</span>
                </Button>
              ))}
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Button variant="ghost" size="sm" onClick={editor.undo} title="Undo">
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={editor.redo} title="Redo">
                <Redo2 className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Button variant="ghost" size="sm" onClick={() => setScale((s) => Math.max(0.4, s - 0.25))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(scale * 100)}%
              </span>
              <Button variant="ghost" size="sm" onClick={() => setScale((s) => Math.min(3, s + 0.25))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex-1 overflow-auto bg-muted/40 p-6">
                <div className="mx-auto flex w-fit flex-col gap-8">
                  {doc.pages.map((p, i) => (
                    <div key={`${p.sourceIndex}-${i}`} ref={(el) => void (pageRefs.current[i] = el)}>
                      <PageCanvas
                        doc={doc}
                        page={p}
                        order={i}
                        scale={scale}
                        tool={tool}
                        style={style}
                        selectedId={sel?.id ?? null}
                        onSelect={(id, type) => setSel(id && type ? { id, type } : null)}
                        onToolDone={() => setTool("select")}
                        onRequestImage={(place) => {
                          imgCb.current = place;
                          imgRef.current?.click();
                        }}
                        api={editor}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <aside className="hidden w-64 shrink-0 flex-col gap-4 border-l border-border bg-sidebar p-4 md:flex">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {selectedBlock ? "Original text" : selectedAnn ? "Object" : "Style"}
                </h2>

                {selectedBlock && (
                  <div className="space-y-3 text-sm">
                    <Field label="Font in file">
                      <span className="truncate text-xs text-muted-foreground">{selectedBlock.rawFont}</span>
                    </Field>
                    {!selectedBlock.editable ? (
                      <p className="flex gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Locked: this font can't be reproduced exactly, so editing it would change how
                        the line looks. Cover it with a whiteout and add new text instead.
                      </p>
                    ) : (
                      <>
                        <Field label="Size">
                          <span className="text-xs text-muted-foreground">
                            {selectedBlock.size.toFixed(1)} pt
                          </span>
                        </Field>
                        <Field label="Colour">
                          <input
                            type="color"
                            value={selectedBlock.color}
                            onChange={(e) =>
                              editor.patchBlock(selectedBlock.id, {
                                color: e.target.value,
                                edited: true,
                              })
                            }
                            className="h-7 w-10 rounded border border-border bg-transparent"
                          />
                        </Field>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() =>
                            editor.patchBlock(selectedBlock.id, {
                              deleted: !selectedBlock.deleted,
                              edited: true,
                            })
                          }
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" />
                          {selectedBlock.deleted ? "Restore line" : "Remove line"}
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {selectedAnn && (
                  <ObjectPanel
                    a={selectedAnn}
                    onPatch={(patch) => editor.patchAnnotation(selectedAnn.id, patch)}
                    onDelete={() => {
                      editor.removeAnnotation(selectedAnn.id);
                      setSel(null);
                    }}
                  />
                )}

                {!selectedBlock && !selectedAnn && (
                  <div className="space-y-3">
                    <Field label="Font">
                      <select
                        value={style.fontKey}
                        onChange={(e) => setStyle({ ...style, fontKey: e.target.value as FontKey })}
                        className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      >
                        {FONT_KEYS.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Size">
                      <input
                        type="number"
                        min={6}
                        max={96}
                        value={style.size}
                        onChange={(e) => setStyle({ ...style, size: Number(e.target.value) })}
                        className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </Field>
                    <Field label="Colour">
                      <input
                        type="color"
                        value={style.color}
                        onChange={(e) => setStyle({ ...style, color: e.target.value })}
                        className="h-7 w-10 rounded border border-border bg-transparent"
                      />
                    </Field>
                    <Field label="Fill">
                      <input
                        type="color"
                        value={style.fill}
                        onChange={(e) => setStyle({ ...style, fill: e.target.value })}
                        className="h-7 w-10 rounded border border-border bg-transparent"
                      />
                    </Field>
                    <Field label="Stroke">
                      <input
                        type="number"
                        step={0.5}
                        min={0.5}
                        max={12}
                        value={style.strokeWidth}
                        onChange={(e) => setStyle({ ...style, strokeWidth: Number(e.target.value) })}
                        className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs"
                      />
                    </Field>
                    <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                      Click any line of the document to retype it in place. Lines whose font can't be
                      matched exactly stay locked.
                    </p>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-foreground">{label}</span>
      {children}
    </div>
  );
}

function ObjectPanel({
  a,
  onPatch,
  onDelete,
}: {
  a: Annotation;
  onPatch: (p: Partial<Annotation>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Type">
        <span className="text-xs capitalize text-muted-foreground">{a.kind}</span>
      </Field>
      {a.kind === "text" && (
        <>
          <Field label="Font">
            <select
              value={a.fontKey}
              onChange={(e) => onPatch({ fontKey: e.target.value as FontKey })}
              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {FONT_KEYS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label="Size">
            <input
              type="number"
              value={a.size ?? 14}
              onChange={(e) => onPatch({ size: Number(e.target.value) })}
              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
          </Field>
        </>
      )}
      {a.kind !== "whiteout" && a.kind !== "image" && (
        <Field label={a.kind === "highlight" ? "Highlight" : "Colour"}>
          <input
            type="color"
            value={a.kind === "highlight" ? (a.fill ?? "#ffe066") : (a.color ?? "#111111")}
            onChange={(e) =>
              onPatch(a.kind === "highlight" ? { fill: e.target.value } : { color: e.target.value })
            }
            className="h-7 w-10 rounded border border-border bg-transparent"
          />
        </Field>
      )}
      <Button variant="outline" size="sm" className="w-full" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" /> Delete object
      </Button>
    </div>
  );
}

function Dropzone({
  busy,
  onPick,
  onFile,
}: {
  busy: boolean;
  onPick: () => void;
  onFile: (f: File) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center bg-muted/30 p-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cn(
          "w-full max-w-xl rounded-2xl border-2 border-dashed border-border bg-card p-12 text-center transition-colors",
          over && "border-primary bg-accent",
        )}
      >
        <FilePlus2 className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-5 font-display text-3xl tracking-tight text-foreground">
          Edit a PDF like a document
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Retype existing paragraphs in place, add text, images, signatures and shapes, and
          rearrange pages. Your file never leaves this device.
        </p>
        <Button size="lg" className="mt-6" disabled={busy} onClick={onPick}>
          {busy ? "Reading document…" : "Choose a PDF"}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">or drop it anywhere in this box</p>
      </div>
    </div>
  );
}
