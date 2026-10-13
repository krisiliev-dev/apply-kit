# Track reads the whole job mailbox; matching asks when unsure; the app never sends

Track keeps every email in the dedicated job mailbox in the local database, not only job-alert emails: one read of the mailbox per check serves both Discover's alert Sources and Track. Each non-alert email is classified (confirmation, rejection, interview invitation, offer, request for information, other) by the AI model through the same pinned non-China hosts and monthly budget as extraction, and matched to an Application by deterministic signals (sender domain, the company's and target posting's domains, job title, thread headers, addresses the user taught it). Only a confident, unique match changes a Status, and always as an undoable Event; anything less becomes "Email to match" in Needs you, and the user's answer is remembered per sender. When the AI budget runs out, only rule-based matches apply and the rest wait for the user. Messages to employers are drafted only: the user sends them from their own mail and presses "Mark sent" (a BCC to the job mailbox lets apply-kit notice instead).

## Why

- Reading the mailbox twice (once per feature) would double IMAP traffic and let the two features disagree about what arrived. One store, read once, keeps Discover's alert rhythm and Track's matching on the same facts.
- A wrong Status is worse than a late one: it cancels follow-ups and skews Stats silently. So the matcher may only act when it can explain itself, and the user can always see and undo why.
- The app never acting in the user's name is a product rule (PRODUCT.md): no SMTP, no Gmail send scope, no "send" button anywhere.

## Considered options

- **Classify with rules only** (known ATS templates): rejected as the only path. Rejections and invitations are free text, often in Bulgarian; rules alone would leave most emails for the user to match. Kept as the fallback when the budget is out.
- **Store only matched emails:** rejected. An unmatched email that later turns out to matter (a recruiter writing from a new domain) would be gone; "nothing disappears silently".
- **Send follow-ups through Gmail with the user's approval:** rejected. It needs a send-capable credential and moves the app across the "user presses send" line.

## Consequences

- The job mailbox's email bodies live in the local SQLite database (personal data, never in git, covered by the nightly backup). Only the minimum text needed for classification goes to the AI provider.
- The mail reader's message shape grows (recipients, thread headers, attachment names); alert parsing is unchanged.
- Tests use recorded synthetic emails and a fake classifier that returns recorded outputs; no live IMAP or AI in tests.
