import type { DocState, EmbeddedFont, PageState, TextBlock } from "./types";
import { cssFontFor, resolveFontStrict } from "./fonts";

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

function clamp255(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Walk the page's operator list to recover the fill colour that was active for
 * every text-showing operator. getTextContent() does not expose colour at all,
 * so without this pass every line would come back black.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectRunColors(page: any, OPS: any): Promise<string[]> {
  const list = await page.getOperatorList();
  const colors: string[] = [];
  let current = "#000000";
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.setFillRGBColor) {
      current = toHex(args[0], args[1], args[2]);
    } else if (fn === OPS.setFillGray) {
      const v = (args[0] ?? 0) * 255;
      current = toHex(v, v, v);
    } else if (fn === OPS.setFillCMYKColor) {
      const [c, m, y, k] = args as number[];
      current = toHex(
        255 * (1 - Math.min(1, c! + k!)),
        255 * (1 - Math.min(1, m! + k!)),
        255 * (1 - Math.min(1, y! + k!)),
      );
    } else if (Array.isArray(args?.[0]) && fn === OPS.setFillColorN) {
      const a = args[0] as number[];
      if (a.length === 3) current = toHex(a[0]! * 255, a[1]! * 255, a[2]! * 255);
    } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      colors.push(current);
    }
  }
  return colors;
}

/** Lift the actual font programs out of the file so we can re-embed them byte-for-byte. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFont(page: any, loadedName: string): EmbeddedFont | null {
  try {
    if (!loadedName || !page.commonObjs.has(loadedName)) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f: any = page.commonObjs.get(loadedName);
    if (!f || f.missingFile || !f.data || !f.data.length) return null;
    const data = new Uint8Array(f.data);
    const cssFamily = `pdfemb-${loadedName}`;
    if (typeof document !== "undefined" && !document.fonts.check(`12px "${cssFamily}"`)) {
      try {
        const face = new FontFace(cssFamily, data.slice().buffer as ArrayBuffer);
        void face.load().then((l) => document.fonts.add(l)).catch(() => {});
      } catch {
        /* preview font is best-effort */
      }
    }
    return {
      ref: loadedName,
      name: f.name ?? loadedName,
      data,
      cssFamily,
      charset: new Set<number>(),
      ascent: f.ascent ?? 0.75,
      descent: f.descent ?? -0.25,
    };
  } catch {
    return null;
  }
}

/** Parse a PDF into page metadata plus editable text lines. */
export async function loadDocument(file: File): Promise<DocState> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: buf.slice() }).promise;

  const pages: PageState[] = [];
  const blocks: TextBlock[] = [];
  const fonts: Record<string, EmbeddedFont> = {};

  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    pages.push({
      sourceIndex: i,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate ?? 0,
    });

    const runColors = await collectRunColors(page, lib.OPS).catch(() => [] as string[]);
    const content = await page.getTextContent();
    const styles = content.styles ?? {};

    type Item = {
      str: string;
      x: number;
      y: number;
      /** position along the baseline direction */
      along: number;
      /** position across the baseline direction */
      cross: number;
      width: number;
      size: number;
      angle: number;
      font: string;
      color: string;
    };
    const items: Item[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raws = content.items as any[];
    const uniqueColors = new Set(runColors);
    for (let k = 0; k < raws.length; k++) {
      const it = raws[k];
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const t = it.transform as number[];
      const a = t[0]!;
      const b = t[1]!;
      // Real baseline angle, so sideways / rotated text is no longer treated
      // as a very wide horizontal line.
      const angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
      const size = Math.hypot(t[2]!, t[3]!) || Math.hypot(a, b) || 12;
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const x = t[4]!;
      const y = t[5]!;
      const color =
        runColors.length === raws.length
          ? (runColors[k] ?? "#000000")
          : uniqueColors.size === 1
            ? (runColors[0] ?? "#000000")
            : (runColors[Math.floor((k / Math.max(1, raws.length)) * runColors.length)] ??
              "#000000");
      items.push({
        str: it.str,
        x,
        y,
        along: x * cos + y * sin,
        cross: -x * sin + y * cos,
        width: it.width ?? 0,
        size,
        angle,
        font: it.fontName ?? "",
        color,
      });
    }
    items.sort((p, q) => p.angle - q.angle || q.cross - p.cross || p.along - q.along);

    let line: Item[] = [];
    const flush = () => {
      if (!line.length) return;
      const first = line[0]!;
      const last = line[line.length - 1]!;
      const text = line
        .map((it, idx) => {
          if (idx === 0) return it.str;
          const prev = line[idx - 1]!;
          const gap = it.along - (prev.along + prev.width);
          return (gap > prev.size * 0.2 && !/\s$/.test(prev.str) ? " " : "") + it.str;
        })
        .join("");
      const style = styles[first.font];
      const embedded = fonts[first.font] ?? extractFont(page, first.font);
      if (embedded) fonts[embedded.ref] = embedded;
      const fontKey = resolveFontStrict(first.font, style?.fontFamily);
      const width = last.along + last.width - first.along;
      // Reproduce the original tracking: how much wider the run is than the
      // glyphs alone, spread over the gaps between characters.
      const naturalRatio = 0.5; // rough average glyph advance, refined at export
      const natural = text.length * first.size * naturalRatio;
      const charSpacing =
        text.length > 1 && width > 0 ? (width - natural) / (text.length - 1) : 0;
      const [vx, vy] = viewport.convertToViewportPoint(first.x, first.y) as [number, number];
      blocks.push({
        id: uid(),
        pageIndex: i,
        x: first.x,
        baseline: first.y,
        viewX: vx,
        topBaseline: vy,
        width,
        size: first.size,
        angle: first.angle,
        charSpacing,
        original: text,
        text,
        fontRef: embedded?.ref ?? null,
        fontKey,
        cssFont: embedded
          ? `"${embedded.cssFamily}", ${cssFontFor[fontKey ?? "Helvetica"]}`
          : cssFontFor[fontKey ?? "Helvetica"],
        rawFont: embedded?.name || style?.fontFamily || first.font || "unknown",
        editable: Boolean(embedded) || fontKey !== null,
        color: first.color,
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
      const sameLine =
        prev.angle === it.angle && Math.abs(prev.cross - it.cross) < Math.max(1.5, prev.size * 0.3);
      const gap = it.along - (prev.along + prev.width);
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
    fonts,
  };
}

// Parse each file once and reuse it for every page render.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docCache = new WeakMap<Uint8Array, Promise<any>>();
async function getCachedDoc(bytes: Uint8Array) {
  let p = docCache.get(bytes);
  if (!p) {
    const lib = await getPdfjs();
    p = lib.getDocument({ data: bytes.slice() }).promise;
    docCache.set(bytes, p);
  }
  return p;
}

/** Render one page of the source document to a canvas at the given scale. */
export async function renderPageToCanvas(
  bytes: Uint8Array,
  sourceIndex: number,
  scale: number,
  canvas: HTMLCanvasElement,
  rotation: number,
) {
  const doc = await getCachedDoc(bytes);
  const page = await doc.getPage(sourceIndex + 1);
  const viewport = page.getViewport({ scale, rotation });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holder = canvas as any;
  holder.__pdfTask?.cancel?.();
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const task = page.render({ canvasContext: ctx, viewport });
  holder.__pdfTask = task;
  try {
    await task.promise;
    return true;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.name !== "RenderingCancelledException") throw err;
    return false;
  } finally {
    if (holder.__pdfTask === task) holder.__pdfTask = null;
  }
}
