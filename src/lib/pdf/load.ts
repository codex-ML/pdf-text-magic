import type { DocState, PageState, TextBlock } from "./types";
import { resolveFontStrict } from "./fonts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjs: any = null;

export async function getPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjs = lib;
  return lib;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Parse a PDF into page metadata plus editable text lines. */
export async function loadDocument(file: File): Promise<DocState> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: buf.slice() }).promise;

  const pages: PageState[] = [];
  const blocks: TextBlock[] = [];

  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    pages.push({
      sourceIndex: i,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate ?? 0,
    });

    const content = await page.getTextContent();
    const styles = content.styles ?? {};

    type Item = {
      str: string;
      x: number;
      y: number;
      width: number;
      size: number;
      font: string;
    };
    const items: Item[] = [];
    for (const raw of content.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = raw as any;
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const t = it.transform as number[];
      const size = Math.hypot(t[2]!, t[3]!) || Math.hypot(t[0]!, t[1]!) || 12;
      items.push({
        str: it.str,
        x: t[4]!,
        y: t[5]!,
        width: it.width ?? 0,
        size,
        font: it.fontName ?? "",
      });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    let line: Item[] = [];
    const flush = () => {
      if (!line.length) return;
      const first = line[0]!;
      const last = line[line.length - 1]!;
      const text = line
        .map((it, idx) => {
          if (idx === 0) return it.str;
          const prev = line[idx - 1]!;
          const gap = it.x - (prev.x + prev.width);
          return (gap > prev.size * 0.2 && !/\s$/.test(prev.str) ? " " : "") + it.str;
        })
        .join("");
      const style = styles[first.font];
      const fontKey = resolveFontStrict(first.font, style?.fontFamily);
      blocks.push({
        id: uid(),
        pageIndex: i,
        x: first.x,
        baseline: first.y,
        width: last.x + last.width - first.x,
        size: first.size,
        original: text,
        text,
        fontKey,
        rawFont: style?.fontFamily || first.font || "unknown",
        editable: fontKey !== null,
        color: "#000000",
        edited: false,
        deleted: false,
      });
      line = [];
    };

    for (const it of items) {
      if (!line.length) {
        line.push(it);
        continue;
      }
      const prev = line[line.length - 1]!;
      const sameLine = Math.abs(prev.y - it.y) < Math.max(1.5, prev.size * 0.3);
      const gap = it.x - (prev.x + prev.width);
      if (sameLine && gap < prev.size * 1.2 && gap > -prev.size) line.push(it);
      else {
        flush();
        line.push(it);
      }
    }
    flush();
  }

  await doc.destroy?.();

  return {
    fileName: file.name.replace(/\.pdf$/i, ""),
    bytes: buf,
    pages,
    blocks,
    annotations: [],
  };
}

/** Render one page of the source document to a canvas at the given scale. */
export async function renderPageToCanvas(
  bytes: Uint8Array,
  sourceIndex: number,
  scale: number,
  canvas: HTMLCanvasElement,
  rotation: number,
) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(sourceIndex + 1);
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holder = canvas as any;
  holder.__pdfTask?.cancel?.();
  const task = page.render({ canvasContext: ctx, viewport });
  holder.__pdfTask = task;
  try {
    await task.promise;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.name !== "RenderingCancelledException") throw err;
  } finally {
    if (holder.__pdfTask === task) holder.__pdfTask = null;
    await doc.destroy?.();
  }
}
