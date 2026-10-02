/**
 * Seed script: loads cross-reference mappings (XREF records) into the
 * StrongsData DynamoDB table from the cskit-strongs-rb concordance dataset.
 *
 * For each Strong's number, this script creates XREF records that map the
 * number to every Bible verse where it appears. The SK is formatted as
 * `XREF#<padded-book-order>#<BookName>#<chapter>:<verse>` so that DynamoDB
 * sort-key ordering produces canonical Bible order.
 *
 * Usage:
 *   cd infra && npm run seed-xrefs
 *
 * Prerequisites:
 *   - AWS credentials configured (via env vars, profile, or SSO)
 *   - StrongsData DynamoDB table already created (via CDK deploy)
 *
 * Data source: https://github.com/camertron/cskit-strongs-rb (Apache-2.0, public domain text)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import * as https from 'node:https';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env['STRONGS_TABLE_NAME'] ?? 'StrongsData';
const REGION = process.env['AWS_REGION'] ?? 'us-east-1';

const CONCORDANCE_BASE_URL =
  'https://raw.githubusercontent.com/camertron/cskit-strongs-rb/master/resources/concordance';

/** Max items per BatchWriteItem call (DynamoDB limit). */
const BATCH_SIZE = 25;

/** Concurrent chapter downloads per book to avoid hammering GitHub. */
const DOWNLOAD_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Bible book metadata — canonical order, folder names, display names, chapters
// ---------------------------------------------------------------------------

interface BookMeta {
  /** Canonical order (1-66). */
  order: number;
  /** Folder name in the concordance repo. */
  folder: string;
  /** Human-readable display name (e.g. "1 Samuel"). */
  display: string;
  /** Total chapters in this book. */
  chapters: number;
}

const BOOKS: BookMeta[] = [
  // -- Old Testament --
  { order: 1, folder: 'genesis', display: 'Genesis', chapters: 50 },
  { order: 2, folder: 'exodus', display: 'Exodus', chapters: 40 },
  { order: 3, folder: 'leviticus', display: 'Leviticus', chapters: 27 },
  { order: 4, folder: 'numbers', display: 'Numbers', chapters: 36 },
  { order: 5, folder: 'deuteronomy', display: 'Deuteronomy', chapters: 34 },
  { order: 6, folder: 'joshua', display: 'Joshua', chapters: 24 },
  { order: 7, folder: 'judges', display: 'Judges', chapters: 21 },
  { order: 8, folder: 'ruth', display: 'Ruth', chapters: 4 },
  { order: 9, folder: 'i_samuel', display: '1 Samuel', chapters: 31 },
  { order: 10, folder: 'ii_samuel', display: '2 Samuel', chapters: 24 },
  { order: 11, folder: 'i_kings', display: '1 Kings', chapters: 22 },
  { order: 12, folder: 'ii_kings', display: '2 Kings', chapters: 25 },
  { order: 13, folder: 'i_chronicles', display: '1 Chronicles', chapters: 29 },
  { order: 14, folder: 'ii_chronicles', display: '2 Chronicles', chapters: 36 },
  { order: 15, folder: 'ezra', display: 'Ezra', chapters: 10 },
  { order: 16, folder: 'nehemiah', display: 'Nehemiah', chapters: 13 },
  { order: 17, folder: 'esther', display: 'Esther', chapters: 10 },
  { order: 18, folder: 'job', display: 'Job', chapters: 42 },
  { order: 19, folder: 'psalms', display: 'Psalms', chapters: 150 },
  { order: 20, folder: 'proverbs', display: 'Proverbs', chapters: 31 },
  { order: 21, folder: 'ecclesiastes', display: 'Ecclesiastes', chapters: 12 },
  { order: 22, folder: 'song_of_solomon', display: 'Song of Solomon', chapters: 8 },
  { order: 23, folder: 'isaiah', display: 'Isaiah', chapters: 66 },
  { order: 24, folder: 'jeremiah', display: 'Jeremiah', chapters: 52 },
  { order: 25, folder: 'lamentations', display: 'Lamentations', chapters: 5 },
  { order: 26, folder: 'ezekiel', display: 'Ezekiel', chapters: 48 },
  { order: 27, folder: 'daniel', display: 'Daniel', chapters: 12 },
  { order: 28, folder: 'hosea', display: 'Hosea', chapters: 14 },
  { order: 29, folder: 'joel', display: 'Joel', chapters: 3 },
  { order: 30, folder: 'amos', display: 'Amos', chapters: 9 },
  { order: 31, folder: 'obadiah', display: 'Obadiah', chapters: 1 },
  { order: 32, folder: 'jonah', display: 'Jonah', chapters: 4 },
  { order: 33, folder: 'micah', display: 'Micah', chapters: 7 },
  { order: 34, folder: 'nahum', display: 'Nahum', chapters: 3 },
  { order: 35, folder: 'habakkuk', display: 'Habakkuk', chapters: 3 },
  { order: 36, folder: 'zephaniah', display: 'Zephaniah', chapters: 3 },
  { order: 37, folder: 'haggai', display: 'Haggai', chapters: 2 },
  { order: 38, folder: 'zechariah', display: 'Zechariah', chapters: 14 },
  { order: 39, folder: 'malachi', display: 'Malachi', chapters: 4 },
  // -- New Testament --
  { order: 40, folder: 'matthew', display: 'Matthew', chapters: 28 },
  { order: 41, folder: 'mark', display: 'Mark', chapters: 16 },
  { order: 42, folder: 'luke', display: 'Luke', chapters: 24 },
  { order: 43, folder: 'john', display: 'John', chapters: 21 },
  { order: 44, folder: 'acts', display: 'Acts', chapters: 28 },
  { order: 45, folder: 'romans', display: 'Romans', chapters: 16 },
  { order: 46, folder: 'i_corinthians', display: '1 Corinthians', chapters: 16 },
  { order: 47, folder: 'ii_corinthians', display: '2 Corinthians', chapters: 13 },
  { order: 48, folder: 'galatians', display: 'Galatians', chapters: 6 },
  { order: 49, folder: 'ephesians', display: 'Ephesians', chapters: 6 },
  { order: 50, folder: 'philippians', display: 'Philippians', chapters: 4 },
  { order: 51, folder: 'colossians', display: 'Colossians', chapters: 4 },
  { order: 52, folder: 'i_thessalonians', display: '1 Thessalonians', chapters: 5 },
  { order: 53, folder: 'ii_thessalonians', display: '2 Thessalonians', chapters: 3 },
  { order: 54, folder: 'i_timothy', display: '1 Timothy', chapters: 6 },
  { order: 55, folder: 'ii_timothy', display: '2 Timothy', chapters: 4 },
  { order: 56, folder: 'titus', display: 'Titus', chapters: 3 },
  { order: 57, folder: 'philemon', display: 'Philemon', chapters: 1 },
  { order: 58, folder: 'hebrews', display: 'Hebrews', chapters: 13 },
  { order: 59, folder: 'james', display: 'James', chapters: 5 },
  { order: 60, folder: 'i_peter', display: '1 Peter', chapters: 5 },
  { order: 61, folder: 'ii_peter', display: '2 Peter', chapters: 3 },
  { order: 62, folder: 'i_john', display: '1 John', chapters: 5 },
  { order: 63, folder: 'ii_john', display: '2 John', chapters: 1 },
  { order: 64, folder: 'iii_john', display: '3 John', chapters: 1 },
  { order: 65, folder: 'judee', display: 'Jude', chapters: 1 },
  { order: 66, folder: 'revelation', display: 'Revelation', chapters: 22 },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single word entry in the concordance chapter JSON. */
interface ConcordanceWord {
  text: string;
  number: string; // e.g. "g26" or "h120"
}

/** A chapter JSON file: verse number (string) → array of word entries. */
type ChapterData = Record<string, ConcordanceWord[]>;

/**
 * An XREF location keyed for canonical sort.
 * The sortKey encodes book order + chapter + verse so DynamoDB SK ordering
 * produces canonical Bible order.
 */
interface XrefLocation {
  /** DynamoDB SK: `XREF#<BB>#<BookName>#<CCC>:<VVV>` */
  sk: string;
  /** Human-readable reference: e.g. "Romans 5:8" */
  reference: string;
}

interface WriteRequest {
  PutRequest: {
    Item: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Download a URL and return the full body as a string. */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode ?? 'unknown'} for ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Zero-pad a number to a given width. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Normalize a Strong's number from the concordance format ("g26", "h120")
 * to the application format ("G26", "H120").
 */
function normalizeStrongsNumber(raw: string): string {
  return raw.toUpperCase();
}

/**
 * Run an array of async tasks with limited concurrency.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Core: download concordance data and build inverted index
// ---------------------------------------------------------------------------

/**
 * Download a single chapter JSON file and extract Strong's number → verse
 * mappings. Returns a Map of Strong's number → Set of XrefLocation.
 */
async function processChapter(
  book: BookMeta,
  chapter: number,
): Promise<Map<string, XrefLocation[]>> {
  const url = `${CONCORDANCE_BASE_URL}/${book.folder}/${chapter}.json`;
  const result = new Map<string, XrefLocation[]>();

  let raw: string;
  try {
    raw = await fetchText(url);
  } catch {
    // Some chapters may be missing (known quirks in the dataset)
    return result;
  }

  let data: ChapterData;
  try {
    data = JSON.parse(raw) as ChapterData;
  } catch {
    console.warn(`  ⚠️  Could not parse ${book.folder}/${chapter}.json`);
    return result;
  }

  for (const [verseStr, words] of Object.entries(data)) {
    const verse = parseInt(verseStr, 10);
    // Deduplicate Strong's numbers within a single verse
    const seenInVerse = new Set<string>();

    for (const word of words) {
      if (!word.number) continue;
      const strongsNum = normalizeStrongsNumber(word.number);
      if (seenInVerse.has(strongsNum)) continue;
      seenInVerse.add(strongsNum);

      // Build a sort key that produces canonical Bible order:
      // XREF#<BB>#<BookName>#<CCC>:<VVV>
      // BB = 2-digit book order, CCC = 3-digit chapter, VVV = 3-digit verse
      const sk = `XREF#${pad(book.order, 2)}#${book.display}#${pad(chapter, 3)}:${pad(verse, 3)}`;
      const reference = `${book.display} ${chapter}:${verse}`;

      if (!result.has(strongsNum)) {
        result.set(strongsNum, []);
      }
      result.get(strongsNum)!.push({ sk, reference });
    }
  }

  return result;
}

/**
 * Merge chapter-level maps into the global inverted index.
 */
function mergeInto(global: Map<string, XrefLocation[]>, chunk: Map<string, XrefLocation[]>): void {
  for (const [strongsNum, locations] of chunk) {
    if (!global.has(strongsNum)) {
      global.set(strongsNum, []);
    }
    global.get(strongsNum)!.push(...locations);
  }
}

// ---------------------------------------------------------------------------
// DynamoDB batch writing
// ---------------------------------------------------------------------------

/**
 * Convert the inverted index into DynamoDB write requests.
 */
function buildWriteRequests(index: Map<string, XrefLocation[]>): WriteRequest[] {
  const requests: WriteRequest[] = [];

  for (const [strongsNum, locations] of index) {
    const pk = `STRONGS#${strongsNum}`;

    for (const loc of locations) {
      requests.push({
        PutRequest: {
          Item: {
            PK: pk,
            SK: loc.sk,
            reference: loc.reference,
          },
        },
      });
    }
  }

  return requests;
}

/**
 * Write items in batches of 25 with unprocessed-item retry.
 */
async function batchWrite(
  docClient: DynamoDBDocumentClient,
  requests: WriteRequest[],
): Promise<void> {
  let written = 0;
  const total = requests.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    let unprocessed: WriteRequest[] = batch;

    while (unprocessed.length > 0) {
      const cmd = new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: unprocessed,
        },
      });

      const result = await docClient.send(cmd);
      const retryItems = result.UnprocessedItems?.[TABLE_NAME] as WriteRequest[] | undefined;

      if (retryItems && retryItems.length > 0) {
        console.log(`  ⏳ ${retryItems.length} unprocessed items, retrying...`);
        unprocessed = retryItems;
        await new Promise((r) => setTimeout(r, 200));
      } else {
        unprocessed = [];
      }
    }

    written += batch.length;
    if (written % 10000 === 0 || written === total) {
      console.log(`  [XREF] ${written}/${total} items written`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Seeding cross-references into StrongsData table: "${TABLE_NAME}" in region "${REGION}"`,
  );

  const client = new DynamoDBClient({ region: REGION });
  const docClient = DynamoDBDocumentClient.from(client);

  // Build the inverted index: Strong's number → verse locations
  const index = new Map<string, XrefLocation[]>();
  let totalChapters = 0;

  for (const book of BOOKS) {
    console.log(`\n📖 Processing ${book.display} (${book.chapters} chapters)...`);

    // Build tasks for all chapters in this book
    const tasks = Array.from({ length: book.chapters }, (_, i) => {
      const chapter = i + 1;
      return () => processChapter(book, chapter);
    });

    // Download chapters with limited concurrency
    const chapterResults = await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY);

    for (const chapterMap of chapterResults) {
      mergeInto(index, chapterMap);
    }

    totalChapters += book.chapters;
    console.log(`  ✓ ${book.display} done (${index.size} unique Strong's numbers so far)`);
  }

  console.log(`\n📊 Download complete:`);
  console.log(`  Books processed: ${BOOKS.length}`);
  console.log(`  Chapters processed: ${totalChapters}`);
  console.log(`  Unique Strong's numbers: ${index.size}`);

  // Count total XREF records
  let totalXrefs = 0;
  for (const locations of index.values()) {
    totalXrefs += locations.length;
  }
  console.log(`  Total XREF records to write: ${totalXrefs}`);

  // Write to DynamoDB
  console.log(`\n✍️  Writing XREF records to DynamoDB...`);
  const requests = buildWriteRequests(index);
  await batchWrite(docClient, requests);

  console.log(
    `\n✅ Done! Seeded ${totalXrefs} cross-reference records for ${index.size} Strong's numbers.`,
  );
}

main().catch((err: unknown) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
