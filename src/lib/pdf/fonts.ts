import { StandardFonts } from "pdf-lib";
import type { FontKey } from "./types";

export const FONT_KEYS: FontKey[] = [
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
];

export const standardFontFor: Record<FontKey, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  "Helvetica-Bold": StandardFonts.HelveticaBold,
  "Helvetica-Oblique": StandardFonts.HelveticaOblique,
  "Helvetica-BoldOblique": StandardFonts.HelveticaBoldOblique,
  "Times-Roman": StandardFonts.TimesRoman,
  "Times-Bold": StandardFonts.TimesRomanBold,
  "Times-Italic": StandardFonts.TimesRomanItalic,
  "Times-BoldItalic": StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier,
  "Courier-Bold": StandardFonts.CourierBold,
  "Courier-Oblique": StandardFonts.CourierOblique,
  "Courier-BoldOblique": StandardFonts.CourierBoldOblique,
};

export const cssFontFor: Record<FontKey, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Helvetica-Bold": "Helvetica, Arial, sans-serif",
  "Helvetica-Oblique": "Helvetica, Arial, sans-serif",
  "Helvetica-BoldOblique": "Helvetica, Arial, sans-serif",
  "Times-Roman": "'Times New Roman', Times, serif",
  "Times-Bold": "'Times New Roman', Times, serif",
  "Times-Italic": "'Times New Roman', Times, serif",
  "Times-BoldItalic": "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
  "Courier-Bold": "'Courier New', Courier, monospace",
  "Courier-Oblique": "'Courier New', Courier, monospace",
  "Courier-BoldOblique": "'Courier New', Courier, monospace",
};

export function isBold(key: FontKey) {
  return key.includes("Bold");
}
export function isItalic(key: FontKey) {
  return key.includes("Italic") || key.includes("Oblique");
}

/**
 * Strict font resolution: we only allow in-place editing when the embedded
 * font maps unambiguously onto a metric-compatible standard font. Anything
 * else stays locked so we never silently re-typeset with a wrong face.
 */
export function resolveFontStrict(rawName: string, fontFamily?: string): FontKey | null {
  const hay = `${rawName} ${fontFamily ?? ""}`.toLowerCase();
  const bold = /bold|black|heavy|semibold|[-_,]bd\b/.test(hay);
  const italic = /italic|oblique|[-_,]it\b/.test(hay);

  const isTimes = /times|timesnewroman|nimbusroman|liberationserif|tinos|serif\b/.test(hay);
  const isCourier = /courier|mono|nimbusmono|liberationmono|cousine/.test(hay);
  const isHelv = /helvetica|arial|nimbussan|liberationsans|arimo|sans-?serif/.test(hay);

  if (isCourier) {
    if (bold && italic) return "Courier-BoldOblique";
    if (bold) return "Courier-Bold";
    if (italic) return "Courier-Oblique";
    return "Courier";
  }
  if (isTimes) {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (isHelv) {
    if (bold && italic) return "Helvetica-BoldOblique";
    if (bold) return "Helvetica-Bold";
    if (italic) return "Helvetica-Oblique";
    return "Helvetica";
  }
  return null;
}
