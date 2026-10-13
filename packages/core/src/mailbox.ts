// The job mailbox's failure vocabulary. The mail reader throws a MailboxError; the engine records it
// and Sources shows it once, with what to do about it.

export type MailboxProblem =
  /** GMAIL_ADDRESS or GMAIL_APP_PASSWORD isn't set. */
  | "not-configured"
  /** Gmail refused the sign-in: the app password was revoked, mistyped, or the Google password changed. */
  | "auth"
  /** The configured mailbox folder doesn't exist. */
  | "mailbox-missing"
  /** imap.gmail.com couldn't be reached or didn't answer. */
  | "unreachable"
  /** Anything else. */
  | "error";

export class MailboxError extends Error {
  override readonly name = "MailboxError";
  constructor(readonly problem: MailboxProblem, message: string) {
    super(message);
  }
}

export function mailboxProblemOf(err: unknown): MailboxProblem {
  if (err instanceof MailboxError) return err.problem;
  const problem = (err as { name?: unknown; problem?: unknown } | null)?.problem;
  return typeof problem === "string" && problem in mailboxFix ? (problem as MailboxProblem) : "error";
}

/** What the user does about each problem, in Sources' words. Settings are named, never shown. */
export const mailboxFix: Record<MailboxProblem, string> = {
  "not-configured":
    "Set GMAIL_ADDRESS (the job mailbox's Gmail address) and GMAIL_APP_PASSWORD (an app password for it) in .env, then restart apply-kit.",
  auth:
    "Gmail refused the app password: it was probably revoked, or the Google account password changed. Sign in to the job mailbox's Google account, create a new app password at myaccount.google.com/apppasswords, put it in GMAIL_APP_PASSWORD in .env and restart apply-kit. Jobs already found stay as they are.",
  "mailbox-missing":
    "The folder in GMAIL_MAILBOX doesn't exist in the job mailbox. Leave it empty to read INBOX, or set it to an existing Gmail label, then restart apply-kit.",
  unreachable:
    "Couldn't reach Gmail (imap.gmail.com). Check this Mac is online; apply-kit tries again at the next check.",
  error:
    "Reading the job mailbox failed. apply-kit tries again at the next check; if it keeps failing, check the job mailbox in Gmail and the service log.",
};
