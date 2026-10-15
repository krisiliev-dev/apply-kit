// The job mailbox on Applications (hi-fi: docs/design/hifi/applications.html, states Reading mail,
// Mailbox not connected and Mailbox sign-in failed). Each banner says since when, what still works and
// exactly how to fix it, in the same problem vocabulary and fixes as Sources. While a check reads the
// mailbox, one quiet line says so and the list stays usable.
import type { TrackMailbox } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";
import { fetchCheckStatus } from "../api.ts";
import { dayTime, eventTime, weekdayTime } from "./words.ts";

/** The end of the page-head line: how mail stands ("mail read 09:30", "replies aren't being read"). */
export function mailWords(m: TrackMailbox | null): string | null {
  if (!m) return null;
  if (m.state === "not-connected") return "replies aren't being read";
  if (m.state === "failing" && m.since) return `replies since ${weekdayTime(m.since)} not read yet`;
  if (m.state === "connected" && m.lastReadAt) return `mail read ${eventTime(m.lastReadAt)}`;
  return null;
}

export function MailboxBanner({ mailbox: m }: { mailbox: TrackMailbox | null }) {
  if (!m || (m.state !== "not-connected" && m.state !== "failing")) return null;
  const since = m.since ? dayTime(m.since) : null;
  if (m.state === "not-connected") {
    return (
      <div className="banner warning">
        <span className="text">
          <b>The job mailbox isn't connected{since ? ` (since ${since})` : ""}, so replies aren't matched.</b>{" "}
          Everything else works: Applications, Status changes and stats. {m.fix} apply-kit then reads the last 30 days of mail once and matches what it finds.
        </span>
        <a className="btn sm" href="/settings/sources">Mailbox settings</a>
      </div>
    );
  }
  return (
    <div className="banner error">
      <span className="text">
        <b>apply-kit can't read the job mailbox{since ? ` since ${since}` : ""}.</b>{" "}
        Nothing is lost: mail keeps arriving there, and apply-kit reads everything since then once it's fixed. Everything else works meanwhile. {m.fix}
      </span>
      <a className="btn sm" href="/settings/sources">Mailbox health</a>
    </div>
  );
}

/**
 * Whether a check is reading the job mailbox right now. Polls while it is, and calls `onDone` once
 * it finishes, so the list and Needs you pick up what it matched.
 */
export function useMailReading(onDone: () => void, pollMs = 2_000): boolean {
  const [reading, setReading] = useState(false);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let was = false;
    const poll = () => {
      fetchCheckStatus()
        .then((s) => {
          if (stopped) return;
          const now = !!s.checking;
          setReading(now);
          if (was && !now) done.current();
          was = now;
          if (now) timer = setTimeout(poll, pollMs);
        })
        .catch(() => { if (!stopped) setReading(false); });
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [pollMs]);

  return reading;
}
