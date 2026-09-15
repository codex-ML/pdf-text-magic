import { useCallback, useMemo, useRef, useState } from "react";
import type { Annotation, DocState, PageState, TextBlock } from "./types";

export type Tool =
  | "select"
  | "text"
  | "image"
  | "rect"
  | "ellipse"
  | "line"
  | "highlight"
  | "whiteout"
  | "ink";

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function useEditor() {
  const [doc, setDocState] = useState<DocState | null>(null);
  const past = useRef<DocState[]>([]);
  const future = useRef<DocState[]>([]);
  const [, forceRender] = useState(0);

  const commit = useCallback((next: (prev: DocState) => DocState) => {
    setDocState((prev) => {
      if (!prev) return prev;
      past.current = [...past.current.slice(-49), prev];
      future.current = [];
      return next(prev);
    });
  }, []);

  const load = useCallback((d: DocState) => {
    past.current = [];
    future.current = [];
    setDocState(d);
  }, []);

  const undo = useCallback(() => {
    setDocState((prev) => {
      const last = past.current.pop();
      if (!prev || !last) return prev;
      future.current = [...future.current, prev];
      forceRender((n) => n + 1);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setDocState((prev) => {
      const next = future.current.pop();
      if (!prev || !next) return prev;
      past.current = [...past.current, prev];
      forceRender((n) => n + 1);
      return next;
    });
  }, []);

  const api = useMemo(
    () => ({
      patchBlock: (id: string, patch: Partial<TextBlock>) =>
        commit((p) => ({
          ...p,
          blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        })),
      addAnnotation: (a: Annotation) =>
        commit((p) => ({ ...p, annotations: [...p.annotations, a] })),
      patchAnnotation: (id: string, patch: Partial<Annotation>) =>
        commit((p) => ({
          ...p,
          annotations: p.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),
      removeAnnotation: (id: string) =>
        commit((p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== id) })),
      setPages: (pages: PageState[]) => commit((p) => ({ ...p, pages })),
    }),
    [commit],
  );

  return {
    doc,
    load,
    reset: () => setDocState(null),
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    ...api,
  };
}
