export { createEngine, passReasons, passReasonLabel } from "./engine.ts";
export type { AdjustmentOrigin, AdjustmentMatcher } from "./learned.ts";
export type {
  DiscoveryEngine, FeedQuery, FeedResult, FeedJob, FeedView, HealthState,
  NewSource, SourceInfo, SourceCheck, CheckFailure, CheckResult, CheckOptions, CheckRecord, SourceHealth, SourceStatus, HealthReport, HealthSummary, FailingSource, AlertRhythm, QuietSource, MailboxHealth,
  Decision, JobState, PassReason, PassInput, UnhideInput, LearnedAdjustment,
  ReadingState, ReadResult, JobDetail, JobPosting, AddSourceOptions, RemovalPreview, FeedSort, RuleChange, FilteredToNothing,
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
export { postingFactsSchema, postingLanguageCode } from "./extraction/facts.ts";
export type {
  PostingFacts, SourceQuote, ExtractedRequirement, ExtractedYears, ExtractedLanguage, ExtractedCertificate,
  ExtractedWorkAuthorisation, ExtractedRemote, ExtractedSalary, ExtractionInput, ExtractionResult,
} from "./extraction/facts.ts";
export type { FeedRequirement, RequirementStatus, RequirementEvidence, JobRequirement, KeyFact, FactSource, NeedsYouItem, Screening, FactAnswer } from "./extraction/reading.ts";
export type { EngineDeps, Clock, Timers, SqlDatabase, SqlStatement, SqlValue, Extractor, MailReader, MailMessage, MailAttachment, AlertEmail, Settings } from "./ports.ts";
export type { SourceAdapter, SourceCategory, FoundPosting, AdapterContext, EmailAlertAdapter } from "./sources/adapter.ts";
export { adapters } from "./sources/registry.ts";
export { jobPostingsFromLd } from "./capture/jsonld.ts";
export type { LdJobPosting } from "./capture/jsonld.ts";
export { createScheduler, defaultSchedule, parseSchedule } from "./scheduler.ts";
export type { Scheduler, SchedulerOptions, Schedule, SchedulerStatus, CheckProgress } from "./scheduler.ts";
export type { Fit, FitReason, FitPart, FitBand, FitAdjustment } from "./fit/fit.ts";
export { angles } from "./fit/angles.ts";
export { matchEvidence, withEvidence } from "./fit/evidence.ts";
export type { Evidence, EvidencePiece, RequirementToMatch, RequirementCategory } from "./fit/evidence.ts";
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
export { blindSheet, readVerdicts, formatTailoringReport } from "./evaluation/tailoring-sheet.ts";
export type { BlindKey, Verdict, VerdictReading, ReportInfo as TailoringReportInfo } from "./evaluation/tailoring-sheet.ts";
export { runTailoringEvaluation, tailoringProfileSchema, tailoringSetSchema, tailoringQuestionSchema, jobOf, estimatePackageUsd } from "./evaluation/tailoring.ts";
export type {
  TailoringProfile, TailoringSet, TailoringQuestion, TailoringCase, TailoringModel, TailoringEngine, TailoringOptions, TailoringReport,
  PackageResult, ModelSummary, FlagResult as TailoringFlag, StockPhrase, AnswerResult as TailoringAnswer,
} from "./evaluation/tailoring.ts";
export type { EvaluationOptions, EvaluationReport, EvaluationSummary, CaseResult, FactScore, ListFactScore, SingleFactScore } from "./evaluation/run.ts";
export { createAiBudget } from "./budget.ts";
export type { AiBudget, AiBudgetDeps, AiCharge, AiTask, BudgetInfo, BudgetOutcome } from "./budget.ts";
export { draftedPiecesSchema, learnedVoiceSchema } from "./writing/writer.ts";
export type { Writer, WriterRequest, WriterTask, Written, SentExcerpt, ImportedText, DraftedPieces, LearnedVoice, VoiceLearningInput } from "./writing/writer.ts";
export { VOICE_EXCERPT_WORDS } from "./preparation/voice.ts";
export type { VoiceView, VoiceSample, VoiceSampleFile, VoiceSampleKind, VoiceSampleProblem, VoiceRule, VoiceLanguage, VoiceSend, VoiceLearning, VoiceContext, VoiceContextRequest, VoiceEditInput } from "./preparation/voice.ts";
export { tailoredCvSchema, coachTurnSchema, draftedAnswerSchema } from "./writing/writer.ts";
export type { DraftAnswerInput, DraftedAnswer } from "./writing/writer.ts";
export type { CoachTurn, CoachTurnInput, CoachTopic, CoachLine, CoachEntry } from "./writing/writer.ts";
export type { TailorCvInput, TailoredCv, TailoredLine } from "./writing/writer.ts";
export { writtenLetterSchema } from "./writing/writer.ts";
export type { WriteLetterInput, WrittenLetter } from "./writing/writer.ts";
export { checkWording, validateCv } from "./preparation/honesty.ts";
export type { HeldSummary, HonestyProfile, HonestyRule, HonestyProblem, RejectedLine, ValidatedLine, ValidatedCv } from "./preparation/honesty.ts";
export { createPreparationEngine } from "./preparation/engine.ts";
export type { PreparationEngine, DraftRequest, DocumentDraft, VoiceForDrafts, PrepareForApply, PrepareForTrack } from "./preparation/engine.ts";
export type {
  ApprovedPackage, ApplyQuery, PageJobReference, FrozenFile, PortalJobReference, CvEntryAsSent, PackageState, SubmittedVia, PackageForApply, ProfileForApply, MarkSubmittedResult,
} from "./preparation/contracts.ts";
export { portalJobReference } from "./preparation/portal.ts";
export { sameJobReference } from "./preparation/contracts.ts";
export { atsCheckLabel } from "./preparation/ats-step.ts";
export type { AtsStepView, AtsCheckView, AtsLine, AtsFixView, AtsFixField } from "./preparation/ats-step.ts";
export type { ProfileExport } from "./preparation/engine.ts";
export type {
  ImportFile, ImportInput, ImportInputProblem, ImportField, ImportItem, ImportItemState, ImportMerge, ImportProblem, ImportRun, ImportSource,
  ImportStatus, ImportFileType, ResolveResult, StartImportResult, UnreadableAction, UnreadableChoice, UnreadableReason,
} from "./preparation/import.ts";
export { pieceKinds, numberSources, entryLabel, unattachedGroupLabel, maxAchievementLength } from "./preparation/profile.ts";
export type {
  ProfilePiece, PieceKind, PieceStatus, NumberSource, PieceEntry, PieceSource, PieceInput, PieceOrigin, PieceField, PieceFix,
  PieceProblem, SavePieceResult, PieceQuery, PieceGroup, PieceList, DeletedPiece, ProfileSummary, PieceDispute, PieceVersion, DisputeChoice,
} from "./preparation/profile.ts";
export { answerLanguages, answerCategories, answerKinds, answerModes, languageOf, minMatchConfidence, answerPageSize } from "./preparation/answers.ts";
export type {
  Answer, AnswerInput, AnswerOrigin, AnswerLanguage, AnswerCategory, AnswerKind, AnswerMode, AnswerRule, SalaryRule, Wording,
  AnswerSource, PortalEdit, PortalEditInput, AnswerChange, AnswerQuery, AnswerList, AnswerField, AnswerProblem, SaveAnswerResult, AnswerFill, AnswerMatch,
} from "./preparation/answers.ts";
export { angleRules } from "./preparation/angles.ts";
export { setupSteps, draftFilters } from "./preparation/setup.ts";
export { interviewRules, interviewSource, interviewQuestionKinds, coachStandardQuestions, likelySkills } from "./preparation/interview.ts";
export type {
  InterviewView, InterviewTurn, InterviewItem, InterviewStatus, InterviewScopePart, InterviewQuestionKind, InterviewChange,
  FinishInterviewResult, NearTheLine, SkippedQuestion,
} from "./preparation/interview.ts";
export type { SetupStep, SetupProgress, DraftFilter, DraftCounts, DraftGroup, DraftsToCheck, ConfirmGroupResult, Experience, SearchSuggestion, SetupSummary } from "./preparation/setup.ts";
export type { AngleView, AngleChoice, AnglePosting, SaveAngleInput, SaveAngleResult, AngleProblem } from "./preparation/angles.ts";
export { packageSteps, stepLabel, packageRules } from "./preparation/packages.ts";
export type {
  PackageJob, PackageView, LanguageOption, PackageChip, PackagePart, PackageStep, PackageStepView, PartState, StepState, PrepareStatus, PrepareProblem,
  TargetOption, CvDraftView, StartPackageResult, ApproveResult, ChangeResult, CvChangeView, CvFit, CvVersionView, FlagChoice, LearnedPiece,
  LetterView, LetterCheckView, LetterFileView, AtsFix,
} from "./preparation/packages.ts";
export type {
  ScreeningOrigin, ScreeningNeed, ScreeningAnswerView, ScreeningAnswersView, SalaryView, DraftAnswerResult, DraftAnswerRequest,
} from "./preparation/packages.ts";
export { limitOf, wordCount, standardQuestions } from "./preparation/screening.ts";
export type { AnswerLimit, QuestionType, FormQuestion, PostingSalary } from "./preparation/screening.ts";
export type {
  CvLineView, EvidenceRow, HonestyCheckView, HonestyCheckState, PieceLink, TightenChoice, CvFlagView, FlagKind, FlagOption,
} from "./preparation/cv-version.ts";
export type { Contact, ContactDetails, ContactPhoto, ContactField, ContactProblem, SaveContactResult, PhotoInput } from "./preparation/contact.ts";
export type {
  PreparationDeps, DocumentRenderer, DocumentToRender, DocumentKind, DocumentLanguage, RenderedDocument,
  PdfTextReader, PdfText, FileStore, StoredFile, PackageFolder, TextRecognizer,
} from "./preparation/ports.ts";
export type {
  CvContent, CvRole, CvEducation, LetterContent, Letterhead, DocumentDate, MonthYear, DocumentPhoto,
} from "./documents/content.ts";
export { checkAts } from "./documents/ats.ts";
export type { AtsCheck, AtsCheckId, AtsCheckResult, AtsInput, AtsKeyword } from "./documents/ats.ts";
export { documentFileName } from "./documents/file-names.ts";
export type { FileNameParts } from "./documents/file-names.ts";
export { cvSections, sectionTitles, formatDate, formatRange, formatLetterDate, letterLabels } from "./documents/labels.ts";
export type { CvSection } from "./documents/labels.ts";
export { demoDocument } from "./documents/demo.ts";
export type { DemoOptions } from "./documents/demo.ts";
export { createTracker, statuses, happyPath, maxCvBytes, statusName, isClosed, TrackerError, rejectionReasons, monthlyEurOf } from "./tracker.ts";
export type {
  Tracker, TrackerDeps, ApplicationMarker, JobMarker, Status, EventCause, CreatedHow, ApplicationEvent, ApplicationSummary, AddApplicationInput, AddField,
  AddApplicationResult, GroupKey, ApplicationGroup, ApplicationList, ListQuery, StatusFilter, JobChoice, ApplicationDetail, StatusStep, NextStep, TimelineEntry, Contact as ApplicationContact, TargetPosting, AttachedCv, AttachCvInput,
  NextUp, NeedsYou, NeedsYouEntry, NeedsYouGroup, ComingUp, FollowUpDraft, FollowUpEventKind, NoDraft, UpcomingInterview,
  Withdrawal, Withdrawals, OfferToAnswer, OfferDetails, OfferView, RejectionReason, RejectionView, Submission, SubmissionInput, SubmissionResult, PackagesForTrack,
} from "./tracker.ts";
export { bannedPhrases, defaultFollowUpSettings, draftWords } from "./follow-ups.ts";
export { trackPortsFrom } from "./track-prepare.ts";
export type {
  DraftInput, DraftKind, DraftOutput, FollowUp, FollowUpDraftText, FollowUpKind, FollowUpSettings, MasterProfile, ProfileEvidence,
} from "./follow-ups.ts";
export { interviewFormats, invitedInterviewSchema, prepSheetDraftSchema, zonedToInstant, instantToLocal, isTimeZone } from "./interviews.ts";
export type {
  Interview, InterviewInput, InterviewFormat, InvitedInterview, PrepSheet, PrepQuestion, PrepSheetDraft, PrepSheetInput, ProfileStory, FactTag,
} from "./interviews.ts";
export type { TrackStats, WeekCount, WorkingRow } from "./track-stats.ts";
export { draftOutputSchema, emailKinds, emailClassificationSchema, highConfidence } from "./track-mail.ts";
export type { EmailKind, EmailClassification, ClassifyInput, TrackAssistant } from "./track-mail.ts";
export type {
  EmailSummary, MatchedEmail, MovedByEmail, EmailCandidate, EmailToMatch, EmailAnswer, PackageConfirmation, TrackMailbox, MailProcessed, EmailChange, SinceLastVisit,
} from "./tracker.ts";
export { createFillEngine, FillError } from "./fill/engine.ts";
export type { FillEngine, FillDeps, FillPage, FillSession, FillStart, FillMatch, FillOptions, PackageFileForFill, PackageInBrief, SessionEnd, MarkResult, SubmittedApplication } from "./fill/engine.ts";
export { countOutcomes } from "./fill/reading.ts";
export { fieldReportFixture, fieldStructure } from "./fill/field-report.ts";
export type {
  PageReading, PageKind, ReadField, FieldKind, FieldAnswer, FieldOutcome, Outcome, OutcomeCounts, FillSource, PackageFileKind, RecordedPage, RecordedFill, PendingAnswer, SaveOffer, SavePick, SavedAnswers, FieldStructure, FieldReportInput, FieldReport, EntrySection, DuplicateEntry,
  CopyRow, CopyList,
} from "./fill/reading.ts";

export type { ProfileConsolidator, ConsolidationSuggestion, ConsolidationGroup, ConsolidationPreview } from "./preparation/consolidation.ts";

export type { CareerTimeline, CareerPeriod, CareerResolution } from "./preparation/career.ts";
