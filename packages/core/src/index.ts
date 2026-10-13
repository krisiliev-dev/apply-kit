export { createEngine, passReasons, passReasonLabel } from "./engine.ts";
export type { AdjustmentOrigin, AdjustmentMatcher } from "./learned.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckFailure, CheckResult, CheckOptions, CheckRecord, SourceHealth, SourceStatus, HealthReport, HealthSummary, FailingSource, AlertRhythm, QuietSource, MailboxHealth,
  Decision, JobState, PassReason, PassInput, UnhideInput, LearnedAdjustment,
  ReadingState, ReadResult, JobDetail, JobPosting, BudgetInfo, AddSourceOptions, RemovalPreview, FeedSort, RuleChange, FilteredToNothing,
  AddLinkResult, LinkProblem, PastedPosting, CaptureReport, CaptureItem, CaptureStatus,
  SeedStatus, SeededSource, CompanyWithoutFeed, WatchlistSeed,
} from "./engine.ts";
export type { CapturedPage, MissingField } from "./capture/listings.ts";
export { createPairing } from "./pairing.ts";
export type { Pairing, PairResult, PairedDevice } from "./pairing.ts";
export { sourceRemovedHow, noLongerListedBy } from "./engine.ts";
export type { UnusualDrop, NormalVolume, DropWording } from "./drops.ts";
export type {
  CoverageInput, CoverageListing, CoverageResult, CoverageResultListing, CoverageReason, CoverageReasonKind, CoverageFix,
  CoverageTotals, CoverageSummary, CoverageHistory,
} from "./coverage.ts";
export type { CompanyDetection, SystemProbe, ProbeStatus, Fallback } from "./companies.ts";
export { sofiaWatchlist } from "./watchlist.ts";
export type { WatchlistEntry, WatchlistFeedEntry, WatchlistAlertEntry, WatchlistGroup, WatchlistField, AlertRoute } from "./watchlist.ts";
export { postingFactsSchema } from "./extraction/facts.ts";
export type {
  PostingFacts, SourceQuote, ExtractedRequirement, ExtractedYears, ExtractedLanguage, ExtractedCertificate,
  ExtractedWorkAuthorisation, ExtractedRemote, ExtractedSalary, ExtractionInput, ExtractionResult,
} from "./extraction/facts.ts";
export type { FeedRequirement, RequirementStatus, JobRequirement, KeyFact, FactSource, NeedsYouItem, Screening, FactAnswer } from "./extraction/reading.ts";
export type { EngineDeps, Clock, Timers, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader, MailMessage, MailAttachment, AlertEmail, Settings } from "./ports.ts";
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
export { createTracker, statuses, happyPath, statusName, isClosed, TrackerError } from "./tracker.ts";
export type {
  Tracker, TrackerDeps, Status, EventCause, CreatedHow, ApplicationEvent, ApplicationSummary, AddApplicationInput, AddField,
  AddApplicationResult, GroupKey, ApplicationGroup, ApplicationList, ListQuery, JobChoice, ApplicationDetail, StatusStep, NextStep, TimelineEntry, Contact, TargetPosting,
} from "./tracker.ts";
