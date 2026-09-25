export type FontKey =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Times-BoldItalic"
  | "Courier"
  | "Courier-Bold"
  | "Courier-Oblique"
  | "Courier-BoldOblique";

/** A font program lifted straight out of the source PDF. */
export interface EmbeddedFont {
  /** pdf.js loaded name, unique per document. */
  ref: string;
  /** Human readable name from the file. */
  name: string;
  /** Raw (sanitised) font program bytes, ready for re-embedding. */
  data: Uint8Array;
  /** CSS family registered in document.fonts for pixel-true preview. */
  cssFamily: string;
  /** Code points the font can actually draw. */
  charset: Set<number>;
  ascent: number;
  descent: number;
}

/** A line of text extracted from the original PDF. */
export interface TextBlock {
  id: string;
  pageIndex: number;
  /** PDF user-space coords of the line start, origin bottom-left. */
  x: number;
  baseline: number;
  /** Viewport coords (origin top-left, scale 1) of the line start, honouring CropBox offsets. */
  viewX?: number;
  topBaseline?: number;
  width: number;
  size: number;
  /** Baseline angle in degrees, counter-clockwise (0 = normal horizontal text). */
  angle: number;
  /** Extra space between glyphs in the original, in points. */
  charSpacing: number;
  original: string;
  text: string;
  /** Key into DocState.fonts when the real font could be lifted from the file. */
  fontRef: string | null;
  /** Metric-compatible standard font, used only when there is no embedded font. */
  fontKey: FontKey | null;
  /** Family to use for on-screen preview. */
  cssFont: string;
  /** Raw font name reported by the PDF, for the inspector. */
  rawFont: string;
  /** False only when neither the real font nor a safe substitute is available. */
  editable: boolean;
  color: string;
  edited: boolean;
  deleted: boolean;
}

export type AnnotationKind =
  | "text"
  | "image"
  | "rect"
  | "ellipse"
  | "line"
  | "highlight"
  | "whiteout"
  | "ink";

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  pageIndex: number;
  /** Top-left based box in PDF points, origin top-left of the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontKey?: FontKey;
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  /** ink paths, normalised 0..1 inside the box */
  points?: { x: number; y: number }[];
  imageData?: string;
  imageType?: "png" | "jpg";
}

export interface PageState {
  /** index into the original document */
  sourceIndex: number;
  width: number;
  height: number;
  rotation: number;
  blank?: boolean;
}

export interface DocState {
  fileName: string;
  bytes: Uint8Array;
  pages: PageState[];
  blocks: TextBlock[];
  annotations: Annotation[];
  /** Font programs extracted from the source file, keyed by ref. */
  fonts: Record<string, EmbeddedFont>;
}
