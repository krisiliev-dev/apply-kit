export { createEngine } from "./engine.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckResult, CheckOptions,
} from "./engine.ts";
export type { EngineDeps, Clock, Timers, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader } from "./ports.ts";
export type { SourceAdapter, FoundPosting, AdapterContext } from "./sources/adapter.ts";
export { adapters } from "./sources/registry.ts";
export { createScheduler, defaultSchedule, parseSchedule } from "./scheduler.ts";
export type { Scheduler, SchedulerOptions, Schedule, SchedulerStatus, CheckProgress } from "./scheduler.ts";
