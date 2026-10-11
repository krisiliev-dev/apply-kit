// The hand-labelled answer for one posting in the extraction evaluation set: what a careful
// reader finds in it, in the same terms as the extractor's facts (facts.ts) but without quotes or
// confidence. Labelling rules: eval/extraction/labelling-rules.md.
import { z } from "zod";

const kind = z.enum(["required", "preferred"]);

export const expectedFactsSchema = z.object({
  /** ISO 639-1 code of the posting's language. */
  language: z.string(),
  requirements: z.array(z.object({ text: z.string().min(1), kind })),
  /** `about` is for the reader only; years are matched on min and max. */
  years: z.array(z.object({ min: z.number(), max: z.number().nullable(), about: z.string().optional(), kind })),
  /** `level` is for the reader only; languages are matched on the language. */
  languages: z.array(z.object({ language: z.string().min(1), level: z.string().nullable().optional(), kind })),
  certificates: z.array(z.object({ name: z.string().min(1), kind })),
  visaSponsorship: z.enum(["offered", "not-offered", "not-stated"]),
  remote: z.object({
    mode: z.enum(["on-site", "hybrid", "remote", "not-stated"]),
    locations: z.array(z.string().min(1)),
  }),
  /** Null when the posting says nothing about pay. */
  salary: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: z.string().nullable(),
    period: z.enum(["year", "month", "day", "hour"]).nullable(),
    basis: z.enum(["gross", "net", "not-stated"]),
  }).nullable(),
}).strict();

/** One posting of the evaluation set: where it came from, what the extractor is given, and its label. */
export const evaluationCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  field: z.enum(["dev", "security", "design"]),
  source: z.object({ kind: z.string(), url: z.string().url(), fetchedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  /** Exactly what the engine would send the extractor (posting HTML already turned into text). */
  input: z.object({ title: z.string(), company: z.string(), location: z.string().nullable(), text: z.string().min(1) }),
  expected: expectedFactsSchema,
  /** Anything a future labeller should know about a judgement call in this posting. */
  notes: z.string().optional(),
}).strict();

export type ExpectedFacts = z.infer<typeof expectedFactsSchema>;
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
