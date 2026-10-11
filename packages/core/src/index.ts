export { createEngine } from "./engine.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckResult, ReadingState, ReadResult,
} from "./engine.ts";
export { postingFactsSchema } from "./extraction/facts.ts";
export type {
  PostingFacts, SourceQuote, ExtractedRequirement, ExtractedYears, ExtractedLanguage, ExtractedCertificate,
  ExtractedWorkAuthorisation, ExtractedRemote, ExtractedSalary, ExtractionInput, ExtractionResult,
} from "./extraction/facts.ts";
export type { FeedRequirement, RequirementStatus } from "./extraction/reading.ts";
export type { EngineDeps, Clock, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader } from "./ports.ts";
export type { SourceAdapter, FoundPosting, AdapterContext } from "./sources/adapter.ts";
export { adapters } from "./sources/registry.ts";
