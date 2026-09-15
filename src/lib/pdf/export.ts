import { PDFDocument, degrees, rgb } from "pdf-lib";
import type { Annotation, DocState, FontKey } from "./types";
import { standardFontFor } from "./fonts";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full || "000000", 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function buildPdf(state: DocState): Promise<Uint8Array> {
  const src = await PDFDocument.load(state.bytes.slice(), { ignoreEncryption: true });
  const fontCache = new Map<FontKey, Awaited<ReturnType<typeof src.embedFont>>>();
  const getFont = async (key: FontKey) => {
    const hit = fontCache.get(key);
    if (hit) return hit;
    const f = await src.embedFont(standardFontFor[key]);
    fontCache.set(key, f);
    return f;
  };

  const srcPages = src.getPages();

  // 1. Replace edited text lines in place.
  for (const block of state.blocks) {
    if (!block.edited && !block.deleted) continue;
    const page = srcPages[block.pageIndex];
    if (!page) continue;
    const pad = block.size * 0.14;
    page.drawRectangle({
      x: block.x - pad,
      y: block.baseline - block.size * 0.28,
      width: Math.max(block.width, 1) + pad * 4,
      height: block.size * 1.25,
      color: rgb(1, 1, 1),
    });
    if (block.deleted || !block.text) continue;
    const font = await getFont(block.fontKey ?? "Helvetica");
    page.drawText(block.text, {
      x: block.x,
      y: block.baseline,
      size: block.size,
      font,
      color: hexToRgb(block.color),
    });
  }

  // 2. Draw everything added on top.
  for (const a of state.annotations) {
    const page = srcPages[a.pageIndex];
    if (!page) continue;
    const ph = page.getHeight();
    const y = ph - a.y - a.h;
    await drawAnnotation(page, a, y, getFont);
  }

  // 3. Apply page order / rotation / deletions.
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    state.pages.map((p) => p.sourceIndex),
  );
  copied.forEach((page, i) => {
    const meta = state.pages[i]!;
    page.setRotation(degrees(((meta.rotation % 360) + 360) % 360));
    out.addPage(page);
  });

  return out.save();
}

type AnyPage = ReturnType<PDFDocument["getPages"]>[number];

async function drawAnnotation(
  page: AnyPage,
  a: Annotation,
  y: number,
  getFont: (k: FontKey) => Promise<Awaited<ReturnType<PDFDocument["embedFont"]>>>,
) {
  const stroke = a.strokeWidth ?? 1.5;
  switch (a.kind) {
    case "text": {
      const font = await getFont(a.fontKey ?? "Helvetica");
      const size = a.size ?? 14;
      const lines = (a.text ?? "").split("\n");
      lines.forEach((line, i) => {
        page.drawText(line, {
          x: a.x,
          y: y + a.h - size * (i + 1) * 1.18 + size * 0.22,
          size,
          font,
          color: hexToRgb(a.color ?? "#111111"),
        });
      });
      break;
    }
    case "whiteout":
      page.drawRectangle({ x: a.x, y, width: a.w, height: a.h, color: rgb(1, 1, 1) });
      break;
    case "highlight":
      page.drawRectangle({
        x: a.x,
        y,
        width: a.w,
        height: a.h,
        color: hexToRgb(a.fill ?? "#ffe066"),
        opacity: 0.4,
      });
      break;
    case "rect":
      page.drawRectangle({
        x: a.x,
        y,
        width: a.w,
        height: a.h,
        borderColor: hexToRgb(a.color ?? "#111111"),
        borderWidth: stroke,
        ...(a.fill && a.fill !== "none" ? { color: hexToRgb(a.fill) } : {}),
      });
      break;
    case "ellipse":
      page.drawEllipse({
        x: a.x + a.w / 2,
        y: y + a.h / 2,
        xScale: a.w / 2,
        yScale: a.h / 2,
        borderColor: hexToRgb(a.color ?? "#111111"),
        borderWidth: stroke,
        ...(a.fill && a.fill !== "none" ? { color: hexToRgb(a.fill) } : {}),
      });
      break;
    case "line":
      page.drawLine({
        start: { x: a.x, y: y + a.h },
        end: { x: a.x + a.w, y },
        thickness: stroke,
        color: hexToRgb(a.color ?? "#111111"),
      });
      break;
    case "ink": {
      const pts = a.points ?? [];
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1]!;
        const p1 = pts[i]!;
        page.drawLine({
          start: { x: a.x + p0.x * a.w, y: y + a.h - p0.y * a.h },
          end: { x: a.x + p1.x * a.w, y: y + a.h - p1.y * a.h },
          thickness: stroke,
          color: hexToRgb(a.color ?? "#111111"),
        });
      }
      break;
    }
    case "image": {
      if (!a.imageData) break;
      const bytes = Uint8Array.from(atob(a.imageData.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
      const doc = page.doc;
      const img =
        a.imageType === "jpg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      page.drawImage(img, { x: a.x, y, width: a.w, height: a.h });
      break;
    }
  }
}
