export { createEngine } from "./engine.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckFailure, CheckResult, CheckRecord, SourceHealth, SourceStatus, HealthReport,
} from "./engine.ts";
export type { EngineDeps, Clock, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader } from "./ports.ts";
export type { SourceAdapter, SourceCategory, FoundPosting, AdapterContext } from "./sources/adapter.ts";
export { adapters } from "./sources/registry.ts";
