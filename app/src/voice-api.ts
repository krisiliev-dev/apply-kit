// Voice's API for Profile (ticket #59): the samples, the rules learned with their evidence, the
// "Learn from my edits" switch, and every call that sent Kris's writing to the model. Samples arrive
// as base64 inside JSON (like import), so a web page can't send one without a CORS preflight; they
// stay on this laptop, and learning starts in the background once they're in.
// Drafts (the cover letter, Track's follow-ups) use the voice through the engine, not these routes.
import type { Hono } from "hono";
import type { PreparationEngine, VoiceSampleFile } from "@apply-kit/core";
import { jsonBody, jsonOnly } from "./profile-api.ts";

/** 20 MB per file is about 27 MB of base64; a letter is far smaller. */
const MAX_FILE_BASE64 = 27 * 1024 * 1024;
const MAX_FILES = 20;

export function mountVoiceApi(app: Hono, preparation: PreparationEngine): void {
  /** Learns from what's new without holding up the answer; a failure is logged, and tried again next time. */
  const learnInBackground = () => {
    preparation.learnVoice()
      .then((r) => { if (r.stopped === "failed") console.error(r.message); })
      .catch((err: unknown) => console.error("Learning the voice failed:", err));
  };

  app.get("/api/profile/voice", (c) => c.json(preparation.voice()));

  // What left the machine: every call that sent excerpts of Kris's writing, newest first.
  app.get("/api/profile/voice/sends", (c) => c.json(preparation.voiceSends()));

  // { files: [{ fileName, base64 }] }
  app.post("/api/profile/voice/samples", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const files = Array.isArray(body.files) ? body.files.map(file) : [];
    if (files.length === 0) return c.json({ error: "Choose at least one file." }, 422);
    if (files.length > MAX_FILES) return c.json({ error: `Add up to ${MAX_FILES} samples at a time.` }, 422);
    const bad = files.find((f) => typeof f === "string");
    if (typeof bad === "string") return c.json({ error: bad }, 422);
    await preparation.addVoiceSamples(files as VoiceSampleFile[]);
    learnInBackground();
    return c.json(preparation.voice(), 201);
  });

  // { file: { fileName, base64 } }: the new file takes the old one's place.
  app.post("/api/profile/voice/samples/:id/replace", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    const f = file(body.file);
    if (typeof f === "string") return c.json({ error: f }, 422);
    const replaced = await preparation.replaceVoiceSample(c.req.param("id"), f);
    if (!replaced) return c.json({ error: "No such sample. It may have been removed." }, 404);
    learnInBackground();
    return c.json(preparation.voice());
  });

  app.post("/api/profile/voice/samples/:id/remove", async (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    if (!(await preparation.removeVoiceSample(c.req.param("id")))) return c.json({ error: "No such sample. It may have been removed already." }, 404);
    return c.json(preparation.voice());
  });

  app.post("/api/profile/voice/rules/:id/remove", (c) => {
    if (!jsonOnly(c)) return c.json({ error: "Send Content-Type: application/json" }, 415);
    if (!preparation.removeVoiceRule(c.req.param("id"))) return c.json({ error: "No such rule. It may have been removed already." }, 404);
    return c.json(preparation.voice());
  });

  // { fromEdits: boolean }: the "Learn from my edits" switch.
  app.put("/api/profile/voice/learning", async (c) => {
    const body = await jsonBody(c);
    if (!body) return c.json({ error: "Send a JSON body with Content-Type: application/json" }, 415);
    if (typeof body.fromEdits !== "boolean") return c.json({ error: "fromEdits must be true or false" }, 400);
    return c.json(preparation.setVoiceLearning(body.fromEdits));
  });
}

/** A file sent as { fileName, base64 }, or what's wrong with it. */
function file(v: unknown): VoiceSampleFile | string {
  const f = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!f || typeof f.fileName !== "string" || typeof f.base64 !== "string") return "Send each file as { fileName, base64 }.";
  if (f.base64.length > MAX_FILE_BASE64) return `${f.fileName} is over 20 MB.`;
  return { fileName: f.fileName.slice(0, 255), bytes: new Uint8Array(Buffer.from(f.base64, "base64")) };
}
