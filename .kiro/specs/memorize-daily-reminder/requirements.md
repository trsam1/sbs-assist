# Requirements: Memorize the Scroll — daily due-review reminder

## Context and assumptions

Issue #68 asks for the **daily outbound reminder** promised (and deferred) when the v2 spaced-repetition
scheduler shipped: once a day, email each student who has memorization chunks coming due a single
"**N chunks of &lt;book&gt; are due for review today**" nudge, so the SM-2 schedule actually pulls them
back to the tool. The v2 scheduler (`.kiro/specs/memorize-srs-scheduler/`, shipped) added the per-chunk
`dueDate`/`easeFactor`/`intervalDays`/`repetitions`/`lastReviewed` fields this reminder reads; that was
#68's stated dependency and it is now satisfied.

Unlike every memorization change before it — all additive, client-side, zero-infra — this one is the
**first outbound infrastructure in the app**. There is **no EventBridge rule, no scheduler, no cron, and
no SES/SNS/email path anywhere in the repo today**. So #68 genuinely adds AWS resources and a (near-zero)
cost line, and it touches a per-stage **sender-identity** value that is config the maintainer fills in.

### Confirmed decisions (settled with the user before this draft)

- **D1 — "who is due" is a daily table scan, filtered in the Lambda.** Studies are keyed
  `PK=USER#<sub>` / `SK=MEMORIZE#<scrollStudyId>`, and each chunk's `dueDate` lives **inside** the
  `chunks[]` list — DynamoDB cannot index inside a list, and there is no GSI on due-date. The dispatch
  Lambda therefore **scans the MemorizationStudies table** once a day and computes "due" per chunk in
  code. The table is tiny (one item per user-per-scroll, a few KB each) so a daily scan costs fractions
  of a cent — this matches the app's "simplest service that meets the requirement" posture. A derived
  `nextDueDate` + GSI index was explicitly **rejected** as premature for a single-maintainer app.
- **D2 — delivery is SES email.** An email is the real reminder (it reaches the student when the tool is
  closed, which is the whole point). An in-app badge was rejected for this spec because it only shows
  when the tool is already open. SES runs in **sandbox mode** initially (can only send to *verified*
  recipients), which is sufficient for a personal/single-maintainer tool; broadening later is a one-time
  SES production-access request, out of scope here.
- **D3 — reminders are OPT-IN, default OFF, preference on the existing table.** A student not actively
  memorizing must not get mail. A per-user preference (`reminderOptIn`, optional `reminderHour`) rides
  the existing MemorizationStudies table as a new `SK=PREFS` item under the same `PK=USER#<sub>` — **no
  new table**. Default **off**; a toggle in the memorize view turns it on. "Zero due chunks → no mail"
  falls out of the dispatch logic regardless of the opt-in.

### Assumptions (flagged for the design review; each the lowest-risk reading of the issue)

- **A1 — the sender email address is a per-stage `stage-config.ts` value the maintainer fills in.** The
  CDK (SES identity, EventBridge Scheduler, the dispatch Lambda, IAM) is the agent's to write; the actual
  verified sender string (`reminderSender`) is a **human-fills-in blank** in both the prod and dev
  `StageConfig`, because it touches frozen prod config and must be a real verified address. The spec
  ships the field with a placeholder and the build does **not** invent an address.
- **A2 — recipient email comes from Cognito, not the table.** The memorization record stores only the
  Cognito `sub`. The dispatch Lambda resolves each due user's email via a Cognito **AdminGetUser** (or a
  pool-scoped lookup) on the existing user pool; it never stores the email in DynamoDB.
- **A3 — one email per due user per day, counts/locations only.** The email body names the book and a
  chunk **count** (and optionally the due refs as location labels) — **never verse text**, preserving the
  app-wide "offsets/locations only, no copyrighted text" invariant. A user with multiple due books gets
  one email summarizing all of them.
- **A4 — "due today" in the job uses a date-only compare, matching the client.** A chunk is due when its
  `dueDate` is absent/`''` (never reviewed) or `dueDate <= today` — the same rule `srs.ts isDue` uses in
  the view, so the email and the in-app queue agree. The job's "today" is its run date (UTC date-only;
  `reminderHour` in D3 selects *when* the daily run fires, not the comparison basis).
- **A5 — the preference read/write rides the existing memorization CRUD surface.** A `GET`/`PUT
  /scroll-studies/prefs/memorize-reminder` (or an equivalent additive route on the existing
  `memorization-study` Lambda) reads and writes the `SK=PREFS` item. No new Lambda for the *preference*;
  the only new Lambda is the **dispatch** job.
- **A6 — a scan, not a per-user push, and idempotent-enough.** The daily job is a single scheduled
  invocation that scans, groups by user, and sends. A missed day is simply a missed reminder (the next
  day's run still catches everything still due); no delivery-state table is kept.
- **A7 — new infra is additive and stateful-safe.** The new resources (one Lambda, one schedule, one SES
  identity, one log group, IAM) are **added**, never replacing or removing an existing resource. The
  stateful guard stays clean (no table/user-pool replace/delete); the MemorizationStudies table and the
  user pool are untouched in shape.

---

## Requirement 1: A per-user reminder preference, opt-in, default off

### User Story
As a Bible student, I want to turn the daily review reminder on or off for myself, so I only get mail
when I am actively memorizing.

### Acceptance Criteria
1. The system SHALL persist a per-user preference item in the existing MemorizationStudies table at
   `PK=USER#<sub>` / `SK=PREFS`, holding `reminderOptIn` (boolean) and optional `reminderHour` (integer
   0–23, the local hour the user prefers the reminder; absent → a stage default).
2. The default SHALL be **opt-out**: a user with no PREFS item, or `reminderOptIn=false`, receives **no**
   reminder email.
3. The memorize view SHALL expose a **reminder toggle** (and, when on, an optional hour selector) that
   reads and writes this preference, with a clear on/off label and keyboard/screen-reader support.
4. The preference read/write SHALL use the existing `memorization-study` Lambda (an additive route or
   method), validated server-side (`reminderOptIn` boolean; `reminderHour` integer 0–23 when present);
   **no new table and no new preference Lambda**.
5. The preference item SHALL be per-user and SHALL NOT contain any email address or verse text — the
   email is resolved from Cognito at send time (Requirement 3).

---

## Requirement 2: A daily scheduled job finds who is due

### User Story
As the maintainer, I want a once-a-day job to determine which students have chunks due for review, so a
reminder can be sent without any always-on infrastructure.

### Acceptance Criteria
1. The system SHALL provision an **EventBridge Scheduler** rule that invokes a new **reminder-dispatch
   Lambda** once per day at a fixed stage-configured time.
2. The dispatch Lambda SHALL **scan** the MemorizationStudies table and, for each user's memorization
   studies, compute the set of chunks that are **due** on the run date using the same date-only rule as
   the client (`dueDate` absent/`''`, or `dueDate <= today`).
3. For each user with **≥1 due chunk** AND `reminderOptIn=true` (read from that user's `SK=PREFS` item),
   the job SHALL produce exactly **one** reminder for that user, summarizing the due count per book.
4. A user with **zero** due chunks, or `reminderOptIn` false/absent, SHALL receive **no** reminder,
   regardless of the scan result.
5. The job SHALL read **no** `scrollText` and make **no** Bedrock/AI call; it computes only counts and
   location labels from the stored offsets/refs.
6. A failure resolving one user (e.g. a deleted Cognito user) SHALL NOT abort the whole run — the job
   logs and continues to the next user.

---

## Requirement 3: Send one reminder email per due user, locations only

### User Story
As a Bible student who opted in, I want a short daily email telling me how many chunks of which book are
due, so I come back and do today's review.

### Acceptance Criteria
1. For each due opted-in user, the dispatch Lambda SHALL resolve the user's email from **Cognito** (the
   existing user pool) using the stored `sub`, and send **one** email via **SES** from the
   stage-configured verified sender.
2. The email body SHALL contain the **book name(s)** and the **due chunk count** per book, and MAY list
   the due **reference labels** (e.g. `Philippians 2:1-5`) — and SHALL contain **no verse text** and no
   copyrighted content, preserving the app-wide invariant.
3. The email SHALL link back to the tool (the stage `siteDomain`) so the student can open the memorize
   view and do the review.
4. SES SHALL be used in whatever access mode the account is in (sandbox is acceptable; a sandbox sender
   can only reach verified recipients, which suffices for the maintainer). Requesting SES production
   access is **out of scope** and noted as an operational follow-up.
5. The sender identity SHALL be a **per-stage `reminderSender` value in `stage-config.ts`** that the
   **maintainer fills in** with a real verified address; the build SHALL NOT invent an address, and the
   spec SHALL ship the field as a clearly-marked placeholder blank.

---

## Requirement 4: Additive, stateful-safe infrastructure

### User Story
As the maintainer, I want the reminder infrastructure to add resources without touching any stateful
resource, so the stateful guard stays clean and nothing existing is replaced.

### Acceptance Criteria
1. The feature SHALL add exactly: **one** dispatch Lambda, **one** EventBridge Scheduler schedule,
   **one** SES email identity (the sender), **one** CDK-named log group for the dispatch Lambda, and the
   IAM needed (DynamoDB scan on MemorizationStudies, `cognito-idp:AdminGetUser`/`ListUsers` on the pool,
   `ses:SendEmail` from the verified identity). No new DynamoDB table.
2. The MemorizationStudies table, the Cognito user pool, and every existing resource SHALL be **unchanged
   in shape** — no rename, replace, or delete. The stateful guard SHALL report
   `✅ No stateful-resource replacement or deletion`.
3. The expected resource counts SHALL move **additively**: AWS::Lambda::Function and AWS::Logs::LogGroup
   each **+1** (dispatch Lambda and its log group), DynamoDB::Table **unchanged**. The CDK assertion test
   that pins counts SHALL be updated to the new expected numbers and SHALL assert the new schedule, SES
   identity, and dispatch function/log-group exist.
4. All new per-stage values (`reminderSender`, the schedule time, any dev/prod divergence) SHALL live
   **only** in `stage-config.ts`; no stage name, domain, or address SHALL be hardcoded elsewhere.
5. Per `delivery.md`, the cost impact SHALL be documented (daily Lambda invoke ≈ $0, SES within free
   tier, EventBridge Scheduler negligible) and the prod delta noted.

---

## Non-Functional Requirements

1. **Stack conformance.** Infra change (new dispatch Lambda + schedule + SES identity + log group + IAM)
   plus a small additive frontend toggle and an additive preference route on the existing
   `memorization-study` Lambda. All new per-stage values in `stage-config.ts`. No new table; no change to
   any existing construct ID or physical name.
2. **Additive & stateful-safe.** No stateful resource replaced/removed; guard clean. Counts move
   additively (+1 function, +1 log group); the `diff` job shows only additions, no replace/delete on
   `WordStudyToolStack`.
3. **Copyright policy.** The email carries counts and location labels only — **no verse text**. The
   invariant "offsets/locations only, no copyrighted text" holds end-to-end.
4. **Cost.** Near-zero: one daily Lambda invocation, SES within free tier (first 62k/mo from Lambda),
   EventBridge Scheduler negligible. Documented in `delivery.md`; prod delta noted (a few cents/month at
   most).
5. **Opt-in privacy.** Default off; no email is sent to a user who has not explicitly opted in. The
   preference item stores no email address; recipient email is resolved from Cognito only at send time.
6. **Accessibility.** The reminder toggle and hour selector SHALL be keyboard operable and
   screen-reader labelled, matching the sibling editors' ARIA patterns.
7. **Resilience.** One user's failure (missing email, Cognito error, SES throttle) SHALL be logged and
   skipped, not abort the run. A missed daily run is self-healing — the next run re-sends for anything
   still due.
8. **No test calls AWS, SES, Cognito, or Bedrock.** The dispatch Lambda's due-computation, grouping, and
   body-building are unit-tested with mocked DynamoDB/Cognito/SES clients under the existing no-AWS
   harness; the frontend toggle is tested under the existing TestBed harness; the CDK assertions prove
   the new resources synth.

---

## Out of Scope

- **Requesting SES production access** (leaving sandbox to email arbitrary recipients) — an operational
  one-time maintainer action if signups broaden; this spec ships against SES as-is.
- **Push / SMS / in-app badge** delivery channels — this spec is email only (the in-app due queue
  already shipped with v2).
- **A delivery-log / sent-state table** or de-duplication across the day — the job is a simple daily
  scan-and-send; a missed run self-heals the next day.
- **Per-chunk or per-study reminder granularity, digest scheduling beyond a single daily send, or
  snooze** — one daily summary email per opted-in due user.
- **A GSI / derived `nextDueDate` index** — rejected (D1); the daily scan is sufficient at this scale.
- **Any change** to the v1/v2 memorization data shape beyond the additive `SK=PREFS` item, or to any
  shipped Step 4–12 tool or route.
- **Any AI / Bedrock call.**

## Design Review Responses

_(Reserved for responses to the spec PR's design review, following the sibling specs' convention.
Filled in point-by-point if the review returns CHANGES_REQUESTED.)_
