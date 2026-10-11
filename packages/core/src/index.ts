export { createEngine, passReasons } from "./engine.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckFailure, CheckResult, CheckOptions, CheckRecord, SourceHealth, SourceStatus, HealthReport, HealthSummary, FailingSource, AlertRhythm, QuietSource, MailboxHealth,
  Decision, JobState, PassReason, PassInput,
  ReadingState, ReadResult, JobDetail, JobPosting, BudgetInfo, AddSourceOptions, RemovalPreview, FeedSort, RuleChange, FilteredToNothing,
  AddLinkResult, LinkProblem, PastedPosting,
} from "./engine.ts";
export { sourceRemovedHow } from "./engine.ts";
export type { CompanyDetection, SystemProbe, ProbeStatus, Fallback } from "./companies.ts";
export { postingFactsSchema } from "./extraction/facts.ts";
export type {
  PostingFacts, SourceQuote, ExtractedRequirement, ExtractedYears, ExtractedLanguage, ExtractedCertificate,
  ExtractedWorkAuthorisation, ExtractedRemote, ExtractedSalary, ExtractionInput, ExtractionResult,
} from "./extraction/facts.ts";
export type { FeedRequirement, RequirementStatus, JobRequirement, KeyFact, FactSource, NeedsYouItem, Screening, FactAnswer } from "./extraction/reading.ts";
export type { EngineDeps, Clock, Timers, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader, AlertEmail, Settings } from "./ports.ts";
export type { SourceAdapter, SourceCategory, FoundPosting, AdapterContext, EmailAlertAdapter } from "./sources/adapter.ts";
export { adapters } from "./sources/registry.ts";
export { jobPostingsFromLd } from "./capture/jsonld.ts";
export type { LdJobPosting } from "./capture/jsonld.ts";
export { createScheduler, defaultSchedule, parseSchedule } from "./scheduler.ts";
export type { Scheduler, SchedulerOptions, Schedule, SchedulerStatus, CheckProgress } from "./scheduler.ts";
export type { Fit, FitReason, FitPart, FitBand, FitAdjustment } from "./fit/fit.ts";
export type { Angle } from "./fit/angles.ts";
export type { Place, LocationTier } from "./locations.ts";
export { defaultSearchSettings } from "./search-settings.ts";
export type { SearchSettings } from "./search-settings.ts";
export type { DealbreakerRule, HiddenReason } from "./dealbreakers.ts";
export { MailboxError, mailboxFix } from "./mailbox.ts";
export type { MailboxProblem } from "./mailbox.ts";
export { expectedFactsSchema, evaluationCaseSchema } from "./evaluation/labels.ts";
export type { ExpectedFacts, EvaluationCase } from "./evaluation/labels.ts";
export { scoreCase, similarity, TEXT_MATCH } from "./evaluation/score.ts";
export type { CaseScore, ListScore } from "./evaluation/score.ts";
export { runEvaluation } from "./evaluation/run.ts";
export type { EvaluationOptions, EvaluationReport, EvaluationSummary, CaseResult, FactScore, ListFactScore, SingleFactScore } from "./evaluation/run.ts";
