import { useEffect, useRef, useState } from "react";
import { renderPageToCanvas } from "@/lib/pdf/load";
import type { Annotation, DocState, PageState } from "@/lib/pdf/types";
import { cssFontFor, isBold, isItalic } from "@/lib/pdf/fonts";
import { newId, type Tool } from "@/lib/pdf/useEditor";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  doc: DocState;
  page: PageState;
  order: number;
  scale: number;
  tool: Tool;
  style: {
    color: string;
    fill: string;
    fontKey: Annotation["fontKey"];
    size: number;
    strokeWidth: number;
  };
  selectedId: string | null;
  onSelect: (id: string | null, type: "block" | "annotation" | null) => void;
  onToolDone: () => void;
  onRequestImage: (place: (dataUrl: string, type: "png" | "jpg") => void) => void;
  api: {
    patchBlock: (id: string, patch: Partial<DocState["blocks"][number]>) => void;
    addAnnotation: (a: Annotation) => void;
    patchAnnotation: (id: string, patch: Partial<Annotation>) => void;
  };
}

export function PageCanvas({
  doc,
  page,
  order,
  scale,
  tool,
  style,
  selectedId,
  onSelect,
  onToolDone,
  onRequestImage,
  api,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const inkRef = useRef<{ x: number; y: number }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPageToCanvas(doc.bytes, page.sourceIndex, scale, canvas, 0).catch((e) => console.error("render failed", e));
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [doc.bytes, page.sourceIndex, scale]);

  const w = page.width * scale;
  const h = page.height * scale;
  const rot = ((page.rotation % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;

  const toPage = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = layerRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const startDraw = (e: React.PointerEvent) => {
    if (tool === "select") return;
    if ((e.target as HTMLElement).dataset["handle"]) return;
    e.preventDefault();
    const p = toPage(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "text") {
      const a: Annotation = {
        id: newId(),
        kind: "text",
        pageIndex: page.sourceIndex,
        x: p.x,
        y: p.y,
        w: 240,
        h: style.size * 1.5,
        text: "",
        fontKey: style.fontKey ?? "Helvetica",
        size: style.size,
        color: style.color,
      };
      api.addAnnotation(a);
      setEditingId(a.id);
      onSelect(a.id, "annotation");
      onToolDone();
      return;
    }
    if (tool === "image") {
      onRequestImage((dataUrl, type) => {
        const img = new Image();
        img.onload = () => {
          const width = 220;
          api.addAnnotation({
            id: newId(),
            kind: "image",
            pageIndex: page.sourceIndex,
            x: p.x,
            y: p.y,
            w: width,
            h: (img.height / img.width) * width,
            imageData: dataUrl,
            imageType: type,
          });
        };
        img.src = dataUrl;
      });
      onToolDone();
      return;
    }
    if (tool === "ink") inkRef.current = [p];
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const moveDraw = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = toPage(e);
    if (tool === "ink") inkRef.current.push(p);
    setDraft((d) => (d ? { ...d, w: p.x - d.x, h: p.y - d.y } : d));
  };

  const endDraw = () => {
    if (!draft) return;
    const norm = {
      x: draft.w < 0 ? draft.x + draft.w : draft.x,
      y: draft.h < 0 ? draft.y + draft.h : draft.y,
      w: Math.abs(draft.w),
      h: Math.abs(draft.h),
    };
    setDraft(null);

    if (tool === "ink") {
      const pts = inkRef.current;
      inkRef.current = [];
      if (pts.length < 2) return onToolDone();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const box = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      };
      api.addAnnotation({
        id: newId(),
        kind: "ink",
        pageIndex: page.sourceIndex,
        ...box,
        points: pts.map((p) => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h })),
        color: style.color,
        strokeWidth: style.strokeWidth,
      });
      return onToolDone();
    }

    if (norm.w < 3 || norm.h < 3) return onToolDone();
    api.addAnnotation({
      id: newId(),
      kind: tool as Annotation["kind"],
      pageIndex: page.sourceIndex,
      ...norm,
      color: style.color,
      fill: tool === "highlight" ? style.fill : style.fill,
      strokeWidth: style.strokeWidth,
    });
    onToolDone();
  };

  const dragAnnotation = (e: React.PointerEvent, a: Annotation, mode: "move" | "resize") => {
    e.stopPropagation();
    onSelect(a.id, "annotation");
    const start = toPage(e);
    const origin = { ...a };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = layerRef.current!.getBoundingClientRect();
      const p = { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (mode === "move") api.patchAnnotation(a.id, { x: origin.x + dx, y: origin.y + dy });
      else
        api.patchAnnotation(a.id, {
          w: Math.max(8, origin.w + dx),
          h: Math.max(8, origin.h + dy),
        });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const blocks = doc.blocks.filter((b) => b.pageIndex === page.sourceIndex);
  const annotations = doc.annotations.filter((a) => a.pageIndex === page.sourceIndex);

  const rotateStyle: React.CSSProperties =
    rot === 0
      ? {}
      : {
          transform:
            rot === 90
              ? `rotate(90deg) translate(0, -${h}px)`
              : rot === 180
                ? `rotate(180deg) translate(-${w}px, -${h}px)`
                : `rotate(270deg) translate(-${w}px, 0)`,
          transformOrigin: "top left",
        };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative overflow-hidden rounded-lg border border-border bg-white shadow-page"
        style={{ width: swapped ? h : w, height: swapped ? w : h }}
      >
        <div
          ref={layerRef}
          className={cn(
            "absolute left-0 top-0",
            tool !== "select" && "cursor-crosshair",
          )}
          style={{ width: w, height: h, ...rotateStyle }}
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
        >
          <canvas ref={canvasRef} className="block" style={{ width: w, height: h }} />

          {/* original text lines */}
          {blocks.map((b) => {
            const top = (page.height - b.baseline - b.size * 0.82) * scale;
            const changed = b.edited || b.deleted;
            const selected = selectedId === b.id;
            const family = b.cssFont || cssFontFor[b.fontKey ?? "Helvetica"];
            return (
              <div
                key={b.id}
                className={cn(
                  "group absolute origin-top-left",
                  tool === "select" && b.editable && "cursor-text hover:ring-1 hover:ring-primary/50",
                  tool === "select" && !b.editable && "cursor-not-allowed hover:ring-1 hover:ring-destructive/40",
                  selected && "ring-1 ring-primary",
                )}
                style={{
                  left: b.x * scale - 1,
                  top,
                  minWidth: Math.max(b.width, 6) * scale + 4,
                  height: b.size * 1.16 * scale,
                  background: changed ? "#fff" : "transparent",
                  transform: b.angle ? `rotate(${-b.angle}deg)` : undefined,
                  transformOrigin: "left bottom",
                }}
                onPointerDown={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  e.preventDefault();
                  onSelect(b.id, "block");
                  if (b.editable) setEditingId(b.id);
                }}
              >
                {changed && !b.deleted && (
                  <span
                    className="pointer-events-none absolute left-[1px] whitespace-pre"
                    style={{
                      top: 0,
                      lineHeight: `${b.size * 1.16 * scale}px`,
                      fontSize: b.size * scale,
                      fontFamily: cssFontFor[b.fontKey ?? "Helvetica"],
                      fontWeight: b.fontKey && isBold(b.fontKey) ? 700 : 400,
                      fontStyle: b.fontKey && isItalic(b.fontKey) ? "italic" : "normal",
                      color: b.color,
                    }}
                  >
                    {b.text}
                  </span>
                )}
                {editingId === b.id && b.editable && (
                  <input
                    autoFocus
                    defaultValue={b.text}
                    onBlur={(e) => {
                      setEditingId(null);
                      if (e.target.value !== b.text)
                        api.patchBlock(b.id, { text: e.target.value, edited: true });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="absolute inset-0 w-full bg-white px-[1px] text-foreground outline-none ring-2 ring-primary"
                    style={{
                      fontSize: b.size * scale,
                      fontFamily: cssFontFor[b.fontKey ?? "Helvetica"],
                      fontWeight: b.fontKey && isBold(b.fontKey) ? 700 : 400,
                      fontStyle: b.fontKey && isItalic(b.fontKey) ? "italic" : "normal",
                    }}
                  />
                )}
                {!b.editable && tool === "select" && (
                  <Lock className="absolute -left-4 top-1/2 hidden h-3 w-3 -translate-y-1/2 text-destructive group-hover:block" />
                )}
              </div>
            );
          })}

          {/* added objects */}
          {annotations.map((a) => (
            <AnnotationView
              key={a.id}
              a={a}
              scale={scale}
              selected={selectedId === a.id}
              editing={editingId === a.id}
              onEdit={(text) => api.patchAnnotation(a.id, { text })}
              onEditDone={() => setEditingId(null)}
              onStartEdit={() => setEditingId(a.id)}
              onDrag={dragAnnotation}
            />
          ))}

          {draft && tool !== "ink" && (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-primary/70 bg-primary/5"
              style={{
                left: (draft.w < 0 ? draft.x + draft.w : draft.x) * scale,
                top: (draft.h < 0 ? draft.y + draft.h : draft.y) * scale,
                width: Math.abs(draft.w) * scale,
                height: Math.abs(draft.h) * scale,
              }}
            />
          )}
          {draft && tool === "ink" && (
            <svg className="pointer-events-none absolute left-0 top-0" width={w} height={h}>
              <polyline
                points={inkRef.current.map((p) => `${p.x * scale},${p.y * scale}`).join(" ")}
                fill="none"
                stroke={style.color}
                strokeWidth={style.strokeWidth * scale}
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
      </div>
      <span className="text-xs text-muted-foreground">Page {order + 1}</span>
    </div>
  );
}

function AnnotationView({
  a,
  scale,
  selected,
  editing,
  onEdit,
  onEditDone,
  onStartEdit,
  onDrag,
}: {
  a: Annotation;
  scale: number;
  selected: boolean;
  editing: boolean;
  onEdit: (text: string) => void;
  onEditDone: () => void;
  onStartEdit: () => void;
  onDrag: (e: React.PointerEvent, a: Annotation, mode: "move" | "resize") => void;
}) {
  const box: React.CSSProperties = {
    left: a.x * scale,
    top: a.y * scale,
    width: a.w * scale,
    height: a.h * scale,
  };
  return (
    <div
      className={cn("absolute", selected && "ring-2 ring-primary")}
      style={box}
      onPointerDown={(e) => onDrag(e, a, "move")}
      onDoubleClick={() => a.kind === "text" && onStartEdit()}
    >
      {a.kind === "text" &&
        (editing ? (
          <textarea
            autoFocus
            defaultValue={a.text}
            onBlur={(e) => {
              onEdit(e.target.value);
              onEditDone();
            }}
            className="h-full w-full resize-none bg-white/90 outline-none ring-2 ring-primary"
            style={{
              fontSize: (a.size ?? 14) * scale,
              lineHeight: 1.18,
              fontFamily: cssFontFor[a.fontKey ?? "Helvetica"],
              color: a.color,
            }}
          />
        ) : (
          <div
            className="h-full w-full whitespace-pre-wrap"
            style={{
              fontSize: (a.size ?? 14) * scale,
              lineHeight: 1.18,
              fontFamily: cssFontFor[a.fontKey ?? "Helvetica"],
              fontWeight: a.fontKey && isBold(a.fontKey) ? 700 : 400,
              fontStyle: a.fontKey && isItalic(a.fontKey) ? "italic" : "normal",
              color: a.color,
            }}
          >
            {a.text || "Type here…"}
          </div>
        ))}
      {a.kind === "image" && a.imageData && (
        <img src={a.imageData} alt="" className="h-full w-full object-fill" draggable={false} />
      )}
      {a.kind === "rect" && (
        <div
          className="h-full w-full"
          style={{
            border: `${(a.strokeWidth ?? 1.5) * scale}px solid ${a.color}`,
            background: a.fill && a.fill !== "none" ? a.fill : "transparent",
          }}
        />
      )}
      {a.kind === "ellipse" && (
        <div
          className="h-full w-full rounded-[50%]"
          style={{
            border: `${(a.strokeWidth ?? 1.5) * scale}px solid ${a.color}`,
            background: a.fill && a.fill !== "none" ? a.fill : "transparent",
          }}
        />
      )}
      {a.kind === "line" && (
        <svg className="h-full w-full overflow-visible">
          <line
            x1={0}
            y1={0}
            x2={a.w * scale}
            y2={a.h * scale}
            stroke={a.color}
            strokeWidth={(a.strokeWidth ?? 1.5) * scale}
          />
        </svg>
      )}
      {a.kind === "highlight" && (
        <div className="h-full w-full" style={{ background: a.fill ?? "#ffe066", opacity: 0.4 }} />
      )}
      {a.kind === "whiteout" && <div className="h-full w-full bg-white" />}
      {a.kind === "ink" && (
        <svg className="h-full w-full overflow-visible">
          <polyline
            points={(a.points ?? [])
              .map((p) => `${p.x * a.w * scale},${p.y * a.h * scale}`)
              .join(" ")}
            fill="none"
            stroke={a.color}
            strokeWidth={(a.strokeWidth ?? 1.5) * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {selected && (
        <span
          data-handle="resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onDrag(e, a, "resize");
          }}
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-background bg-primary"
        />
      )}
    </div>
  );
}
