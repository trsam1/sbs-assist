import { describe, it, expect, vi } from 'vitest';
import { backfill, BackfillDeps } from './backfill-scroll-book-link';

/**
 * Build a fake DynamoDBDocumentClient whose `send` dispatches on the command's constructor name.
 * `scrolls` seeds the Scan; `booksByUser` seeds the per-user book Query; Put/Update are recorded.
 */
function makeDeps(
  scrolls: Record<string, unknown>[],
  booksByUser: Record<string, { bookStudyId: string; book: string }[]> = {},
): { deps: BackfillDeps; puts: Record<string, unknown>[]; updates: Record<string, unknown>[] } {
  const puts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const send = vi.fn(
    async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = cmd.constructor.name;
      if (name === 'ScanCommand') {
        return { Items: scrolls, LastEvaluatedKey: undefined };
      }
      if (name === 'QueryCommand') {
        const pk = (cmd.input['ExpressionAttributeValues'] as Record<string, string>)[':pk'];
        const book = (cmd.input['ExpressionAttributeValues'] as Record<string, string>)[':book'];
        const all = booksByUser[pk] ?? [];
        return { Items: all.filter((b) => b.book === book) };
      }
      if (name === 'PutCommand') {
        puts.push(cmd.input['Item'] as Record<string, unknown>);
        return {};
      }
      if (name === 'UpdateCommand') {
        updates.push(cmd.input);
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    },
  );

  return {
    deps: {
      doc: { send } as unknown as BackfillDeps['doc'],
      scrollTable: 'ScrollStudies',
      bookTable: 'BookStudies',
      now: () => '2026-10-26T00:00:00.000Z',
    },
    puts,
    updates,
  };
}

function scroll(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PK: 'USER#u1',
    SK: 'SCROLL#s1',
    scrollStudyId: 's1',
    userId: 'u1',
    bookName: 'John',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('backfill-scroll-book-link', () => {
  it('links an orphan scroll to a pre-existing matching book study', async () => {
    const { deps, puts, updates } = makeDeps([scroll()], {
      'USER#u1': [{ bookStudyId: 'book-existing', book: 'John' }],
    });

    const result = await backfill(deps);

    expect(result).toMatchObject({ scanned: 1, linked: 1, booksCreated: 0, leftOrphaned: 0 });
    expect(puts.length).toBe(0); // no book created
    expect(updates.length).toBe(1);
    expect((updates[0]['ExpressionAttributeValues'] as Record<string, string>)[':bid']).toBe(
      'book-existing',
    );
  });

  it('creates a book study when none matches, then links the scroll to it', async () => {
    const { deps, puts, updates } = makeDeps([scroll({ bookName: 'Jude' })], {});

    const result = await backfill(deps);

    expect(result).toMatchObject({ scanned: 1, linked: 1, booksCreated: 1 });
    expect(puts.length).toBe(1);
    expect(puts[0]['book']).toBe('Jude');
    const createdId = puts[0]['bookStudyId'] as string;
    expect((updates[0]['ExpressionAttributeValues'] as Record<string, string>)[':bid']).toBe(
      createdId,
    );
  });

  it('skips a scroll that already has a bookStudyId (re-run safe)', async () => {
    const { deps, puts, updates } = makeDeps([scroll({ bookStudyId: 'already-there' })]);

    const result = await backfill(deps);

    expect(result).toMatchObject({ scanned: 1, linked: 0, skippedAlreadyLinked: 1 });
    expect(puts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it('links only the newest of several orphans for one book and leaves the rest orphaned', async () => {
    const warnings: string[] = [];
    const { deps, updates } = makeDeps(
      [
        scroll({ SK: 'SCROLL#old', scrollStudyId: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
        scroll({ SK: 'SCROLL#new', scrollStudyId: 'new', updatedAt: '2026-05-01T00:00:00.000Z' }),
      ],
      { 'USER#u1': [{ bookStudyId: 'book-john', book: 'John' }] },
    );
    deps.log = (m) => warnings.push(m);

    const result = await backfill(deps);

    expect(result).toMatchObject({ scanned: 2, linked: 1, leftOrphaned: 1 });
    // The newest scroll is the one linked.
    expect(updates.length).toBe(1);
    expect((updates[0]['Key'] as Record<string, string>)['SK']).toBe('SCROLL#new');
    expect(warnings.some((w) => w.includes('WARN') && w.includes('old'))).toBe(true);
  });

  it('separates orphans for different users with the same bookName', async () => {
    const { deps, updates } = makeDeps(
      [
        scroll({ PK: 'USER#u1', SK: 'SCROLL#a', scrollStudyId: 'a', userId: 'u1' }),
        scroll({ PK: 'USER#u2', SK: 'SCROLL#b', scrollStudyId: 'b', userId: 'u2' }),
      ],
      {
        'USER#u1': [{ bookStudyId: 'book-u1', book: 'John' }],
        'USER#u2': [{ bookStudyId: 'book-u2', book: 'John' }],
      },
    );

    const result = await backfill(deps);

    expect(result).toMatchObject({ linked: 2, leftOrphaned: 0 });
    expect(updates.length).toBe(2);
  });
});
