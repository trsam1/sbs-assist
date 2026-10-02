/**
 * Seed script: loads Open Scriptures Strong's Hebrew and Greek dictionaries
 * into the StrongsData DynamoDB table as DEF and LEXICON records.
 *
 * Usage:
 *   cd infra && npm run seed-strongs
 *
 * Prerequisites:
 *   - AWS credentials configured (via env vars, profile, or SSO)
 *   - StrongsData DynamoDB table already created (via CDK deploy)
 *
 * Data source: https://github.com/openscriptures/strongs (CC-BY-SA, public domain text)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import * as https from 'node:https';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env['STRONGS_TABLE_NAME'] ?? 'StrongsData';
const REGION = process.env['AWS_REGION'] ?? 'us-east-1';

const HEBREW_URL =
  'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js';
const GREEK_URL =
  'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js';

/** Max items per BatchWriteItem call (DynamoDB limit). */
const BATCH_SIZE = 25;

// ---------------------------------------------------------------------------
// Types for the Open Scriptures dictionary entries
// ---------------------------------------------------------------------------

interface HebrewEntry {
  lemma: string;
  xlit: string;
  pron: string;
  derivation: string;
  strongs_def: string;
  kjv_def: string;
}

interface GreekEntry {
  lemma: string;
  translit: string;
  kjv_def: string;
  strongs_def: string;
  derivation: string;
}

type DictionaryEntry = HebrewEntry | GreekEntry;

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

/**
 * The .js files assign a var like:
 *   var strongsHebrewDictionary = { "H1": {...}, ... }
 * Strip the var assignment and trailing semicolon to get pure JSON.
 */
function extractJson(jsSource: string): Record<string, DictionaryEntry> {
  const startIdx = jsSource.indexOf('{');
  if (startIdx === -1) {
    throw new Error('Could not find opening brace in dictionary source');
  }
  // Find the last closing brace (the JSON object end)
  const endIdx = jsSource.lastIndexOf('}');
  if (endIdx === -1) {
    throw new Error('Could not find closing brace in dictionary source');
  }
  const jsonStr = jsSource.slice(startIdx, endIdx + 1);
  return JSON.parse(jsonStr) as Record<string, DictionaryEntry>;
}

/** Type guard: is this a Hebrew entry (has `xlit` field)? */
function isHebrewEntry(entry: DictionaryEntry): entry is HebrewEntry {
  return 'xlit' in entry;
}

/** Build the transliteration string from an entry. */
function getTransliteration(entry: DictionaryEntry): string {
  if (isHebrewEntry(entry)) {
    return entry.xlit || entry.pron || '';
  }
  return (entry as GreekEntry).translit || '';
}

/**
 * Build a combined lexicon string from derivation + KJV definition.
 * This gives a richer "lexicon entry" than the short strongs_def alone.
 */
function buildLexiconEntry(entry: DictionaryEntry): string {
  const parts: string[] = [];
  if (entry.derivation) {
    parts.push(entry.derivation.trim());
  }
  if (entry.strongs_def) {
    parts.push(entry.strongs_def.trim());
  }
  if (entry.kjv_def) {
    parts.push(`KJV: ${entry.kjv_def.trim()}`);
  }
  return parts.join(' — ') || '';
}

/**
 * Convert dictionary entries into DynamoDB write requests (DEF + LEXICON per entry).
 */
function buildWriteRequests(dict: Record<string, DictionaryEntry>): WriteRequest[] {
  const requests: WriteRequest[] = [];

  for (const [strongsNum, entry] of Object.entries(dict)) {
    const pk = `STRONGS#${strongsNum}`;

    // DEF record
    requests.push({
      PutRequest: {
        Item: {
          PK: pk,
          SK: 'DEF',
          definition: entry.strongs_def?.trim() || '',
          originalWord: entry.lemma?.trim() || '',
          transliteration: getTransliteration(entry),
        },
      },
    });

    // LEXICON record
    requests.push({
      PutRequest: {
        Item: {
          PK: pk,
          SK: 'LEXICON',
          lexiconEntry: buildLexiconEntry(entry),
        },
      },
    });
  }

  return requests;
}

/**
 * Write items in batches of 25 with unprocessed-item retry.
 */
async function batchWrite(
  docClient: DynamoDBDocumentClient,
  requests: WriteRequest[],
  label: string,
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
        // Brief pause before retry to respect throughput
        await new Promise((r) => setTimeout(r, 200));
      } else {
        unprocessed = [];
      }
    }

    written += batch.length;
    if (written % 500 === 0 || written === total) {
      console.log(`  [${label}] ${written}/${total} items written`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Seeding StrongsData table: "${TABLE_NAME}" in region "${REGION}"`);

  const client = new DynamoDBClient({ region: REGION });
  const docClient = DynamoDBDocumentClient.from(client);

  // --- Hebrew ---
  console.log('\n📖 Downloading Hebrew dictionary...');
  const hebrewJs = await fetchText(HEBREW_URL);
  const hebrewDict = extractJson(hebrewJs);
  const hebrewCount = Object.keys(hebrewDict).length;
  console.log(`  Found ${hebrewCount} Hebrew entries`);

  const hebrewRequests = buildWriteRequests(hebrewDict);
  console.log(`  Writing ${hebrewRequests.length} items (DEF + LEXICON)...`);
  await batchWrite(docClient, hebrewRequests, 'Hebrew');

  // --- Greek ---
  console.log('\n📖 Downloading Greek dictionary...');
  const greekJs = await fetchText(GREEK_URL);
  const greekDict = extractJson(greekJs);
  const greekCount = Object.keys(greekDict).length;
  console.log(`  Found ${greekCount} Greek entries`);

  const greekRequests = buildWriteRequests(greekDict);
  console.log(`  Writing ${greekRequests.length} items (DEF + LEXICON)...`);
  await batchWrite(docClient, greekRequests, 'Greek');

  // --- Summary ---
  const totalEntries = hebrewCount + greekCount;
  const totalItems = hebrewRequests.length + greekRequests.length;
  console.log(`\n✅ Done! Seeded ${totalEntries} Strong's entries (${totalItems} DynamoDB items).`);
}

main().catch((err: unknown) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
