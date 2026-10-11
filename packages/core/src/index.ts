export { createEngine, passReasons } from "./engine.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckFailure, CheckResult, CheckOptions, CheckRecord, SourceHealth, SourceStatus, HealthReport, HealthSummary, FailingSource,
  Decision, JobState, PassReason, PassInput,
  ReadingState, ReadResult, JobDetail, BudgetInfo,
} from "./engine.ts";
export { postingFactsSchema } from "./extraction/facts.ts";
export type {
  PostingFacts, SourceQuote, ExtractedRequirement, ExtractedYears, ExtractedLanguage, ExtractedCertificate,
  ExtractedWorkAuthorisation, ExtractedRemote, ExtractedSalary, ExtractionInput, ExtractionResult,
} from "./extraction/facts.ts";
export type { FeedRequirement, RequirementStatus, JobRequirement, KeyFact, FactSource, NeedsYouItem, Screening, FactAnswer } from "./extraction/reading.ts";
export type { EngineDeps, Clock, Timers, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader, Settings } from "./ports.ts";
export type { SourceAdapter, SourceCategory, FoundPosting, AdapterContext } from "./sources/adapter.ts";
export { adapters } from "./sources/registry.ts";
export { createScheduler, defaultSchedule, parseSchedule } from "./scheduler.ts";
export type { Scheduler, SchedulerOptions, Schedule, SchedulerStatus, CheckProgress } from "./scheduler.ts";
