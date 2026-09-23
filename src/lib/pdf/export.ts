import { PDFDocument, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Annotation, DocState, FontKey, TextBlock } from "./types";
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

type EmbeddedPdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;

export async function buildPdf(state: DocState): Promise<Uint8Array> {
  const src = await PDFDocument.load(state.bytes.slice(), { ignoreEncryption: true });
  src.registerFontkit(fontkit);

  const stdCache = new Map<FontKey, EmbeddedPdfFont>();
  const getStdFont = async (key: FontKey) => {
    const hit = stdCache.get(key);
    if (hit) return hit;
    const f = await src.embedFont(standardFontFor[key]);
    stdCache.set(key, f);
    return f;
  };

  // Re-embed the font programs lifted from the original file, so edited text is
  // drawn with the exact same glyphs the rest of the line uses.
  const realCache = new Map<string, EmbeddedPdfFont | null>();
  const getRealFont = async (ref: string | null) => {
    if (!ref) return null;
    if (realCache.has(ref)) return realCache.get(ref) ?? null;
    const source = state.fonts[ref];
    let embedded: EmbeddedPdfFont | null = null;
    if (source?.data?.length) {
      try {
        embedded = await src.embedFont(source.data.slice(), { subset: false });
      } catch {
        embedded = null;
      }
    }
    realCache.set(ref, embedded);
    return embedded;
  };

  /** A font can be re-embedded yet still miss a glyph the user just typed. */
  const canRender = (font: EmbeddedPdfFont, text: string) => {
    try {
      font.widthOfTextAtSize(text, 12);
      return true;
    } catch {
      return false;
    }
  };

  const srcPages = src.getPages();

  // 1. Replace edited text lines in place, keeping angle, colour and tracking.
  for (const block of state.blocks) {
    if (!block.edited && !block.deleted) continue;
    const page = srcPages[block.pageIndex];
    if (!page) continue;

    const rad = (block.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const pad = block.size * 0.16;
    const descent = block.size * 0.26;
    const boxW = Math.max(block.width, 1) + pad * 3;
    const boxH = block.size * 1.22;

    // Mask the original glyphs. The rectangle is rotated with the baseline so
    // sideways text is covered exactly instead of being clipped.
    page.drawRectangle({
      x: block.x - pad * cos + descent * sin,
      y: block.baseline - pad * sin - descent * cos,
      width: boxW,
      height: boxH,
      rotate: degrees(block.angle),
      color: rgb(1, 1, 1),
    });

    if (block.deleted || !block.text) continue;

    let font: EmbeddedPdfFont | null = await getRealFont(block.fontRef);
    if (font && !canRender(font, block.text)) font = null;
    if (!font) font = await getStdFont(block.fontKey ?? "Helvetica");

    drawTrackedText(page, block, font, cos, sin);
  }

  // 2. Draw everything added on top.
  for (const a of state.annotations) {
    const page = srcPages[a.pageIndex];
    if (!page) continue;
    const ph = page.getHeight();
    const y = ph - a.y - a.h;
    await drawAnnotation(page, a, y, getStdFont);
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

/**
 * Draw a replacement line. When the original run was tracked wider or tighter
 * than the font's natural advance, the characters are placed one by one so the
 * new text keeps the same density as the surrounding page.
 */
function drawTrackedText(
  page: AnyPage,
  block: TextBlock,
  font: EmbeddedPdfFont,
  cos: number,
  sin: number,
) {
  const color = hexToRgb(block.color);
  const size = block.size;
  const text = block.text;
  const common = { size, font, color, rotate: degrees(block.angle) };

  let natural = 0;
  try {
    natural = font.widthOfTextAtSize(text, size);
  } catch {
    natural = 0;
  }

  let spacing = 0;
  if (natural > 0 && text.length > 1 && block.original.length > 0 && block.width > 0) {
    const density = block.width / block.original.length;
    const target = density * text.length;
    spacing = (target - natural) / (text.length - 1);
    const limit = size * 0.25;
    spacing = Math.max(-size * 0.08, Math.min(limit, spacing));
  }

  if (Math.abs(spacing) < 0.05) {
    page.drawText(text, { ...common, x: block.x, y: block.baseline });
    return;
  }

  let along = 0;
  for (const ch of text) {
    page.drawText(ch, {
      ...common,
      x: block.x + along * cos,
      y: block.baseline + along * sin,
    });
    let adv = size * 0.5;
    try {
      adv = font.widthOfTextAtSize(ch, size);
    } catch {
      /* keep the estimate */
    }
    along += adv + spacing;
  }
}

async function drawAnnotation(
  page: AnyPage,
  a: Annotation,
  y: number,
  getFont: (k: FontKey) => Promise<EmbeddedPdfFont>,
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
