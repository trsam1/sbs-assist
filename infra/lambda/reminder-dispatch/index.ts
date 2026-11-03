import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type {
  MemorizationChunk,
  MemorizationStudyRecord,
  MemorizationReminderPrefRecord,
} from '../shared/models';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({});

// Read env lazily inside the handler (not at module load) so tests can stub it before invoking —
// ESM import hoisting would otherwise freeze these before vi.stubEnv runs.
function env() {
  return {
    memorizationTableName: process.env['MEMORIZATION_STUDIES_TABLE_NAME'] ?? '',
    scrollTableName: process.env['SCROLL_STUDIES_TABLE_NAME'] ?? '',
    userPoolId: process.env['USER_POOL_ID'] ?? '',
    reminderSender: process.env['REMINDER_SENDER'] ?? '',
    siteUrl: process.env['SITE_URL'] ?? '',
  };
}

/** A per-user grouping of the scanned items: that user's studies plus their reminder preference. */
export interface UserGroup {
  studies: MemorizationStudyRecord[];
  optIn: boolean;
  reminderHour?: number;
}

/** A due-review summary for one user, ready to render into an email. */
export interface DueSummary {
  sub: string;
  books: { book: string; dueCount: number; dueRefs: string[] }[];
  totalDue: number;
}

/** A scanned DynamoDB item carries a PK/SK plus either study or pref fields. */
type ScannedItem = Record<string, unknown> & { PK?: string; SK?: string };

/** The Cognito sub for a USER#<sub> partition key, or '' when the key is malformed. */
function subOfPK(pk: string | undefined): string {
  if (!pk || !pk.startsWith('USER#')) return '';
  return pk.slice('USER#'.length);
}

/** Parse an ISO date-or-timestamp to a date-only UTC value (midnight), or null when unparseable. */
function dateOnly(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Midnight-UTC of `today`, for date-only comparisons. */
function startOfUtcDay(today: Date): Date {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

/**
 * True when a chunk is due on `today`: never reviewed (no/empty dueDate) or dueDate <= today.
 * Date-only (ignores time-of-day), matching the client's srs.ts isDue so email and in-app agree.
 */
export function chunkDue(chunk: MemorizationChunk, today: Date): boolean {
  const due = (chunk.dueDate ?? '').trim();
  if (due === '') return true; // never reviewed → due now
  const d = dateOnly(due);
  if (d === null) return true; // unparseable → treat as due rather than silently skip
  return d.getTime() <= startOfUtcDay(today).getTime();
}

/**
 * Partition scanned items into per-user groups: each user's MEMORIZE# studies plus their PREFS
 * item (opt-in + hour). A user with no PREFS item reads as opted-out. Pure.
 */
export function groupByUser(items: ScannedItem[]): Map<string, UserGroup> {
  const groups = new Map<string, UserGroup>();
  const ensure = (sub: string): UserGroup => {
    let g = groups.get(sub);
    if (!g) {
      g = { studies: [], optIn: false };
      groups.set(sub, g);
    }
    return g;
  };

  for (const item of items) {
    const sub = subOfPK(item.PK);
    if (!sub) continue;
    const sk = item.SK ?? '';
    if (sk === 'PREFS') {
      const pref = item as unknown as MemorizationReminderPrefRecord;
      const g = ensure(sub);
      g.optIn = pref.reminderOptIn === true;
      if (typeof pref.reminderHour === 'number') g.reminderHour = pref.reminderHour;
    } else if (sk.startsWith('MEMORIZE#')) {
      ensure(sub).studies.push(item as unknown as MemorizationStudyRecord);
    }
  }
  return groups;
}

/**
 * Compute the due summary for one user on `today`, grouping the due chunks by book. Returns null
 * when nothing is due. `bookNameByScrollId` maps a scrollStudyId to its book name (resolved from
 * the ScrollStudies table); an unknown id falls back to a generic label. Pure.
 */
export function dueSummaryFor(
  sub: string,
  studies: MemorizationStudyRecord[],
  bookNameByScrollId: Map<string, string>,
  today: Date,
): DueSummary | null {
  const byBook = new Map<string, { dueCount: number; dueRefs: string[] }>();

  for (const study of studies) {
    const book = bookNameByScrollId.get(study.scrollStudyId) || 'your scroll';
    for (const chunk of study.chunks ?? []) {
      if (!chunkDue(chunk, today)) continue;
      let entry = byBook.get(book);
      if (!entry) {
        entry = { dueCount: 0, dueRefs: [] };
        byBook.set(book, entry);
      }
      entry.dueCount += 1;
      const ref = (chunk.verseRef ?? '').trim();
      if (ref) entry.dueRefs.push(ref);
    }
  }

  const books = [...byBook.entries()]
    .map(([book, v]) => ({ book, dueCount: v.dueCount, dueRefs: v.dueRefs }))
    .sort((a, b) => a.book.localeCompare(b.book));
  const totalDue = books.reduce((sum, b) => sum + b.dueCount, 0);
  if (totalDue === 0) return null;
  return { sub, books, totalDue };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the email subject + plaintext/HTML body from a summary. Carries book names, counts, and
 * (optionally) reference labels only — NEVER any verse text. Pure.
 */
export function renderReminderEmail(
  summary: DueSummary,
  site: string,
): { subject: string; text: string; html: string } {
  const bookList = summary.books.map((b) => b.book).join(', ');
  const subject =
    summary.totalDue === 1
      ? `1 chunk due for review today`
      : `${summary.totalDue} chunks due for review today`;

  const lines = summary.books.map((b) => {
    const count = `${b.dueCount} ${b.dueCount === 1 ? 'chunk' : 'chunks'}`;
    const refs = b.dueRefs.length ? ` (${b.dueRefs.join(', ')})` : '';
    return `• ${b.book}: ${count} due${refs}`;
  });

  const text = [
    `You have memorization chunks due for review today in ${bookList}.`,
    '',
    ...lines,
    '',
    site ? `Open Memorize the Scroll to review: ${site}` : 'Open Memorize the Scroll to review.',
  ].join('\n');

  const htmlLines = summary.books
    .map((b) => {
      const count = `${b.dueCount} ${b.dueCount === 1 ? 'chunk' : 'chunks'}`;
      const refs = b.dueRefs.length
        ? ` <span style="color:#555">(${escapeHtml(b.dueRefs.join(', '))})</span>`
        : '';
      return `<li><strong>${escapeHtml(b.book)}</strong>: ${count} due${refs}</li>`;
    })
    .join('');
  const link = site
    ? `<p><a href="${escapeHtml(site)}">Open Memorize the Scroll to review</a></p>`
    : `<p>Open Memorize the Scroll to review.</p>`;
  const html = [
    `<p>You have memorization chunks due for review today in ${escapeHtml(bookList)}.</p>`,
    `<ul>${htmlLines}</ul>`,
    link,
  ].join('');

  return { subject, text, html };
}

/** Scan the whole MemorizationStudies table (paginated), returning every item. */
async function scanAll(): Promise<ScannedItem[]> {
  const { memorizationTableName } = env();
  const items: ScannedItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await docClient.send(
      new ScanCommand({ TableName: memorizationTableName, ExclusiveStartKey: lastKey }),
    );
    for (const it of res.Items ?? []) items.push(it as ScannedItem);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return items;
}

/**
 * Resolve book names for a set of (user, scrollStudyId) pairs from the ScrollStudies table.
 * Keyed PK=USER#<sub> / SK=SCROLL#<scrollStudyId>; reads only bookName. Batched. Best-effort —
 * an unresolved id is simply absent and falls back to a generic label in the summary.
 */
async function resolveBookNames(
  pairs: { sub: string; scrollStudyId: string }[],
): Promise<Map<string, string>> {
  const { scrollTableName } = env();
  const names = new Map<string, string>();
  if (!scrollTableName || pairs.length === 0) return names;

  // De-dupe keys and batch in groups of 100 (BatchGet limit).
  const seen = new Set<string>();
  const keys: { PK: string; SK: string }[] = [];
  for (const p of pairs) {
    const k = `${p.sub}|${p.scrollStudyId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    keys.push({ PK: `USER#${p.sub}`, SK: `SCROLL#${p.scrollStudyId}` });
  }

  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    try {
      const res = await docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [scrollTableName]: {
              Keys: batch,
              ProjectionExpression: 'scrollStudyId, bookName',
            },
          },
        }),
      );
      for (const it of res.Responses?.[scrollTableName] ?? []) {
        const rec = it as { scrollStudyId?: string; bookName?: string };
        if (rec.scrollStudyId && rec.bookName) names.set(rec.scrollStudyId, rec.bookName);
      }
    } catch (err) {
      console.error('reminder-dispatch: book-name batch read failed, continuing', err);
    }
  }
  return names;
}

/** Resolve a user's email from Cognito by sub; returns '' when unresolved. */
async function resolveEmail(sub: string): Promise<string> {
  const { userPoolId } = env();
  const res = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: sub }),
  );
  const attr = (res.UserAttributes ?? []).find((a) => a.Name === 'email');
  return attr?.Value ?? '';
}

/**
 * Daily reminder dispatch. Scans the memorization table, groups by user, and for each opted-in
 * user with ≥1 due chunk resolves their email from Cognito and sends ONE SES email summarizing the
 * due counts per book (locations only, never verse text). One user's failure is logged and skipped,
 * never aborting the run. Invoked by EventBridge Scheduler; no HTTP surface.
 */
export const handler = async (): Promise<{ scanned: number; sent: number; skipped: number }> => {
  const { reminderSender, siteUrl } = env();
  const today = new Date();
  let sent = 0;
  let skipped = 0;

  const items = await scanAll();
  const groups = groupByUser(items);

  // Gather the (user, scroll) pairs for opted-in users so book names resolve in one batched pass.
  const pairs: { sub: string; scrollStudyId: string }[] = [];
  for (const [sub, g] of groups) {
    if (!g.optIn) continue;
    for (const s of g.studies) pairs.push({ sub, scrollStudyId: s.scrollStudyId });
  }
  const bookNames = await resolveBookNames(pairs);

  for (const [sub, g] of groups) {
    if (!g.optIn) continue;
    const summary = dueSummaryFor(sub, g.studies, bookNames, today);
    if (!summary) continue; // nothing due → no mail

    try {
      const to = await resolveEmail(sub);
      if (!to) {
        console.warn(`reminder-dispatch: no email for sub ${sub}, skipping`);
        skipped += 1;
        continue;
      }
      const { subject, text, html } = renderReminderEmail(summary, siteUrl);
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: reminderSender,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject },
              Body: { Text: { Data: text }, Html: { Data: html } },
            },
          },
        }),
      );
      sent += 1;
    } catch (err) {
      // One user's failure (missing email, Cognito error, SES throttle/unverified) must not abort.
      console.error(`reminder-dispatch: failed to notify sub ${sub}, continuing`, err);
      skipped += 1;
    }
  }

  console.log(`reminder-dispatch: scanned ${items.length} items, sent ${sent}, skipped ${skipped}`);
  return { scanned: items.length, sent, skipped };
};
