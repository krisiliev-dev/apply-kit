// The exact PDF, shown with pdf.js: each page drawn on a canvas with its text layer on top, so the
// text can be selected and read by a screen reader, and the document's own headings stay out of the
// screen's outline (PA-11). The frame is a focusable named region that scrolls by keyboard (PA-07).
// Fit is an overview; 100% shows the page at its real size, and the choice is remembered (PA-15).
// Give it `key={url}` so a new file starts from "Opening the PDF…".
import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** CSS pixels per PDF point at 100% (96 / 72). An A4 page is 595 points wide. */
const CSS_PER_PT = 96 / 72;
const ZOOM_KEY = "apply-kit.pdf-zoom";

type Zoom = "fit" | "100";

function rememberedZoom(): Zoom {
  try {
    return window.localStorage.getItem(ZOOM_KEY) === "100" ? "100" : "fit";
  } catch {
    return "fit";
  }
}

export function PdfPreview({ url, name, pages, overflow }: {
  url: string;
  /** "CV": the region is named "CV preview, page 1 of 1". */
  name: string;
  /** Page count, read from the PDF by the service. */
  pages: number;
  overflow: boolean;
}) {
  const [zoom, setZoomState] = useState<Zoom>(rememberedZoom);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  // Fit scales the page to the frame's width, so the whole page shows at any screen size.
  useEffect(() => {
    const el = frame.current!;
    const fit = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) * 2;
      const pageWidth = 595 * CSS_PER_PT;
      el.style.setProperty("--fit-zoom", String(Math.min(1, Math.max(0.2, (el.clientWidth - pad) / pageWidth))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setZoom = (z: Zoom) => {
    setZoomState(z);
    try { window.localStorage.setItem(ZOOM_KEY, z); } catch { /* remembered only where storage works */ }
  };

  useEffect(() => {
    let cancelled = false;
    const el = host.current!;
    el.replaceChildren();
    const task = getDocument({ url });
    (async () => {
      const doc: PDFDocumentProxy = await task.promise;
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: CSS_PER_PT });
        const ratio = window.devicePixelRatio || 1;
        const sheet = document.createElement("div");
        sheet.className = "pdf-page";
        sheet.style.width = `${viewport.width}px`;
        sheet.style.height = `${viewport.height}px`;
        sheet.style.setProperty("--total-scale-factor", String(CSS_PER_PT));
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.setAttribute("aria-hidden", "true");
        const text = document.createElement("div");
        text.className = "textLayer";
        sheet.append(canvas, text);
        el.append(sheet);
        await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
        await new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
      }
      if (!cancelled) setState("ready");
    })().catch(() => { if (!cancelled) setState("error"); });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  const pageWord = `${pages} ${pages === 1 ? "page" : "pages"}`;
  return (
    <div ref={frame} className={`doc-frame${zoom === "fit" ? " fit" : ""}`} tabIndex={0} role="region" aria-label={`${name} preview, ${overflow ? `runs onto page ${pages}` : `page 1 of ${pages}`}`}>
      <div className="bar">
        <span className={`page-chip${overflow ? " over" : ""}`}>{overflow ? `Runs onto ${pageWord}` : pageWord}</span>
        <span className="meta">A4 · the exact file</span>
        <span className="grow" />
        <div className="segmented" role="group" aria-label="Zoom">
          <button type="button" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>Fit</button>
          <button type="button" aria-pressed={zoom === "100"} onClick={() => setZoom("100")}>100%</button>
        </div>
      </div>
      {state === "loading" && <p className="meta" role="status">Opening the PDF…</p>}
      {state === "error" && <p className="meta" role="alert">The PDF couldn't be shown here. Download the draft to open it.</p>}
      <div className="pdf-pages" ref={host} />
    </div>
  );
}
