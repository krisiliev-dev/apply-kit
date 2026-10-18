import { expect, it, vi } from "vitest";

// Native font initialisation may fail or stall on macOS. It must not run merely to start the API.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs",()=>{throw new Error("Native PDF engine unavailable");});
it("lets the service construct its reader before the native PDF engine is needed",async()=>{
  const {createPdfJsReader}=await import("./pdf-text.ts");
  expect(typeof createPdfJsReader().read).toBe("function");
});
