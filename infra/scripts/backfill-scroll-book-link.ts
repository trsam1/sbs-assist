/**
 * One-time, idempotent backfill: link each orphan Scroll Study (no `bookStudyId`) to a Book
 * Study for the same user whose `book` matches the scroll's `bookName`, creating a Book Study
 * when none exists. Enforces one-scroll-per-book: for several orphans sharing a bookName, the
 * most-recently-updated scroll is linked and the rest are left orphaned with a warning (never
 * deleted). Re-run safe: a scroll that already has a `bookStudyId` is skipped.
 *
 * Usage (dev first; prod is a deliberate, separate maintainer run):
 *   SCROLL_STUDIES_TABLE_NAME=ScrollStudies-dev BOOK_STUDIES_TABLE_NAME=BookStudies-dev \
 *     npx tsx infra/scripts/backfill-scroll-book-link.ts
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

export interface BackfillDeps {
  doc: Pick<DynamoDBDocumentClient, 'send'>;
  scrollTable: string;
  bookTable: string;
  now?: () => string;
  log?: (msg: string) => void;
}

export interface BackfillResult {
  scanned: number;
  linked: number;
  booksCreated: number;
  skippedAlreadyLinked: number;
  leftOrphaned: number;
}

interface ScrollItem {
  PK: string;
  SK: string;
  scrollStudyId: string;
  userId: string;
  bookStudyId?: string;
  bookName: string;
  updatedAt: string;
}

interface BookItem {
  bookStudyId: string;
  book: string;
}

/**
 * Core logic, dependency-injected for testing. Scans the scroll table, groups orphans by
 * (userId, bookName), links one scroll per group, and reports a tally.
 */
export async function backfill(deps: BackfillDeps): Promise<BackfillResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? (() => {});
  const result: BackfillResult = {
    scanned: 0,
    linked: 0,
    booksCreated: 0,
    skippedAlreadyLinked: 0,
    leftOrphaned: 0,
  };

  // 1. Scan all scroll items (paginated).
  const scrolls: ScrollItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await deps.doc.send(
      new ScanCommand({ TableName: deps.scrollTable, ExclusiveStartKey: lastKey }),
    );
    for (const item of (page.Items ?? []) as ScrollItem[]) scrolls.push(item);
    lastKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  result.scanned = scrolls.length;

  // 2. Keep only orphans (no bookStudyId); count already-linked as skipped.
  const orphans = scrolls.filter((s) => {
    const linked = typeof s.bookStudyId === 'string' && s.bookStudyId.length > 0;
    if (linked) result.skippedAlreadyLinked += 1;
    return !linked;
  });

  // 3. Group orphans by (userId, bookName).
  const groups = new Map<string, ScrollItem[]>();
  for (const s of orphans) {
    const key = `${s.userId}\u0000${s.bookName}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  // 4. For each group: find/create a book study, link the newest scroll, warn on the rest.
  for (const [, group] of groups) {
    group.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); // newest first
    const winner = group[0];
    const { userId, bookName } = winner;

    const bookStudyId = await findOrCreateBookStudy(deps, userId, bookName, now, log, result);

    await deps.doc.send(
      new UpdateCommand({
        TableName: deps.scrollTable,
        Key: { PK: winner.PK, SK: winner.SK },
        UpdateExpression: 'SET bookStudyId = :bid',
        ExpressionAttributeValues: { ':bid': bookStudyId },
      }),
    );
    result.linked += 1;
    log(`Linked scroll ${winner.scrollStudyId} (${bookName}) -> book ${bookStudyId}`);

    for (const extra of group.slice(1)) {
      result.leftOrphaned += 1;
      log(
        `WARN: scroll ${extra.scrollStudyId} for "${bookName}" left orphaned ` +
          `(one scroll per book; link it manually if it should be kept)`,
      );
    }
  }

  return result;
}

/** Find a book study for (userId, bookName) or create one; returns its id. */
async function findOrCreateBookStudy(
  deps: BackfillDeps,
  userId: string,
  bookName: string,
  now: () => string,
  log: (msg: string) => void,
  result: BackfillResult,
): Promise<string> {
  const existing = await deps.doc.send(
    new QueryCommand({
      TableName: deps.bookTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: '#book = :book',
      ExpressionAttributeNames: { '#book': 'book' },
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':sk': 'BOOKSTUDY#',
        ':book': bookName,
      },
    }),
  );
  const match = ((existing.Items ?? []) as BookItem[])[0];
  if (match) return match.bookStudyId;

  const bookStudyId = randomUUID();
  const ts = now();
  await deps.doc.send(
    new PutCommand({
      TableName: deps.bookTable,
      Item: {
        PK: `USER#${userId}`,
        SK: `BOOKSTUDY#${bookStudyId}`,
        bookStudyId,
        userId,
        book: bookName,
        title: '',
        notes: '',
        referents: [],
        createdAt: ts,
        updatedAt: ts,
        GSI1PK: `USER#${userId}`,
        GSI1SK: `UPDATED#${ts}`,
      },
    }),
  );
  result.booksCreated += 1;
  log(`Created book study ${bookStudyId} for "${bookName}" (user ${userId})`);
  return bookStudyId;
}

/* istanbul ignore next -- CLI entry; logic is tested via backfill() */
async function main(): Promise<void> {
  const scrollTable = process.env['SCROLL_STUDIES_TABLE_NAME'];
  const bookTable = process.env['BOOK_STUDIES_TABLE_NAME'];
  if (!scrollTable || !bookTable) {
    throw new Error('SCROLL_STUDIES_TABLE_NAME and BOOK_STUDIES_TABLE_NAME must be set.');
  }
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const result = await backfill({
    doc,
    scrollTable,
    bookTable,
    log: (m) => console.log(m),
  });
  console.log(`Backfill complete: ${JSON.stringify(result)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
