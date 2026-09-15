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

/** A line of text extracted from the original PDF. */
export interface TextBlock {
  id: string;
  pageIndex: number;
  /** PDF user-space coords, origin bottom-left. */
  x: number;
  baseline: number;
  width: number;
  size: number;
  original: string;
  text: string;
  fontKey: FontKey | null;
  /** Raw font name reported by the PDF, for the inspector. */
  rawFont: string;
  /** Strict mode: false when the embedded font cannot be safely reproduced. */
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
}
