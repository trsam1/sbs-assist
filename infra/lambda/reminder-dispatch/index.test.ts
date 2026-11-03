import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock the three SDKs before importing the handler ---
const { mockDdbSend, mockCognitoSend, mockSesSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn(),
  mockCognitoSend: vi.fn(),
  mockSesSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class MockDynamoDBClient {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
  ScanCommand: class MockScanCommand {
    constructor(public input: unknown) {}
  },
  BatchGetCommand: class MockBatchGetCommand {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class MockCognito {
    send = mockCognitoSend;
  },
  AdminGetUserCommand: class MockAdminGetUserCommand {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class MockSes {
    send = mockSesSend;
  },
  SendEmailCommand: class MockSendEmailCommand {
    constructor(public input: unknown) {}
  },
}));

vi.stubEnv('MEMORIZATION_STUDIES_TABLE_NAME', 'MemorizationStudies');
vi.stubEnv('SCROLL_STUDIES_TABLE_NAME', 'ScrollStudies');
vi.stubEnv('USER_POOL_ID', 'us-east-1_pool');
vi.stubEnv('REMINDER_SENDER', 'sender@example.com');
vi.stubEnv('SITE_URL', 'https://example.com');

import { handler, groupByUser, dueSummaryFor, renderReminderEmail, chunkDue } from './index';
import type { MemorizationStudyRecord } from '../shared/models';

const TODAY = new Date('2026-11-02T09:00:00.000Z');

function studyItem(sub: string, scrollStudyId: string, chunks: Record<string, unknown>[]) {
  return {
    PK: `USER#${sub}`,
    SK: `MEMORIZE#${scrollStudyId}`,
    scrollStudyId,
    userId: sub,
    chunks,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function prefItem(sub: string, reminderOptIn: boolean, reminderHour?: number) {
  return {
    PK: `USER#${sub}`,
    SK: 'PREFS',
    reminderOptIn,
    ...(reminderHour !== undefined ? { reminderHour } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

function ch(overrides: Record<string, unknown> = {}) {
  return { start: 0, end: 20, verseRef: '1:1', state: 'learning' as const, ...overrides };
}

describe('reminder-dispatch — pure core', () => {
  describe('chunkDue', () => {
    it('is due when never reviewed (absent or empty dueDate)', () => {
      expect(chunkDue(ch({ dueDate: undefined }), TODAY)).toBe(true);
      expect(chunkDue(ch({ dueDate: '' }), TODAY)).toBe(true);
    });
    it('is due when dueDate is today or earlier (date-only)', () => {
      expect(chunkDue(ch({ dueDate: '2026-11-02' }), TODAY)).toBe(true);
      expect(chunkDue(ch({ dueDate: '2026-10-30' }), TODAY)).toBe(true);
      // same calendar day but a later time-of-day still counts as due (date-only)
      expect(chunkDue(ch({ dueDate: '2026-11-02T23:59:00.000Z' }), TODAY)).toBe(true);
    });
    it('is NOT due when dueDate is in the future', () => {
      expect(chunkDue(ch({ dueDate: '2026-11-03' }), TODAY)).toBe(false);
      expect(chunkDue(ch({ dueDate: '2026-12-01' }), TODAY)).toBe(false);
    });
    it('treats an unparseable dueDate as due rather than silently skipping', () => {
      expect(chunkDue(ch({ dueDate: 'not-a-date' }), TODAY)).toBe(true);
    });
  });

  describe('groupByUser', () => {
    it('partitions studies and the PREFS item per user; no PREFS → opted-out', () => {
      const groups = groupByUser([
        studyItem('u1', 's1', [ch()]),
        prefItem('u1', true, 8),
        studyItem('u2', 's2', [ch()]),
      ]);
      expect(groups.get('u1')?.optIn).toBe(true);
      expect(groups.get('u1')?.reminderHour).toBe(8);
      expect(groups.get('u1')?.studies).toHaveLength(1);
      expect(groups.get('u2')?.optIn).toBe(false); // no PREFS item
    });
    it('ignores items with a malformed PK', () => {
      const groups = groupByUser([{ PK: 'BAD', SK: 'PREFS', reminderOptIn: true }]);
      expect(groups.size).toBe(0);
    });
  });

  describe('dueSummaryFor', () => {
    const books = new Map([
      ['s1', 'Philippians'],
      ['s2', 'Colossians'],
    ]);

    it('counts due chunks, groups by book, sorts by book', () => {
      const studies = [
        studyItem('u1', 's2', [
          ch({ dueDate: '' }),
          ch({ dueDate: '2026-11-01', verseRef: '1:2' }),
        ]),
        studyItem('u1', 's1', [ch({ dueDate: '2026-11-02', verseRef: '2:5' })]),
      ] as unknown as MemorizationStudyRecord[];
      const summary = dueSummaryFor('u1', studies, books, TODAY)!;
      expect(summary.totalDue).toBe(3);
      expect(summary.books.map((b) => b.book)).toEqual(['Colossians', 'Philippians']);
      expect(summary.books.find((b) => b.book === 'Colossians')?.dueCount).toBe(2);
      expect(summary.books.find((b) => b.book === 'Philippians')?.dueRefs).toEqual(['2:5']);
    });

    it('returns null when nothing is due (all future)', () => {
      const studies = [
        studyItem('u1', 's1', [ch({ dueDate: '2026-12-01' })]),
      ] as unknown as MemorizationStudyRecord[];
      expect(dueSummaryFor('u1', studies, books, TODAY)).toBeNull();
    });

    it('counts a legacy chunk with no dueDate as due', () => {
      const studies = [
        studyItem('u1', 's1', [{ start: 0, end: 10, verseRef: '', state: 'new' }]),
      ] as unknown as MemorizationStudyRecord[];
      expect(dueSummaryFor('u1', studies, books, TODAY)?.totalDue).toBe(1);
    });

    it('falls back to a generic label when the book name is unknown', () => {
      const studies = [studyItem('u1', 'unknown', [ch()])] as unknown as MemorizationStudyRecord[];
      expect(dueSummaryFor('u1', studies, books, TODAY)?.books[0].book).toBe('your scroll');
    });
  });

  describe('renderReminderEmail', () => {
    it('carries book names, counts, refs and the site link — never verse text', () => {
      const summary = {
        sub: 'u1',
        totalDue: 3,
        books: [
          { book: 'Philippians', dueCount: 2, dueRefs: ['2:1-5', '2:6-11'] },
          { book: 'Colossians', dueCount: 1, dueRefs: [] },
        ],
      };
      const { subject, text, html } = renderReminderEmail(summary, 'https://example.com');
      expect(subject).toBe('3 chunks due for review today');
      expect(text).toContain('Philippians');
      expect(text).toContain('2:1-5');
      expect(text).toContain('https://example.com');
      expect(html).toContain('<strong>Philippians</strong>');
      expect(html).toContain('href="https://example.com"');
    });
    it('uses the singular for one chunk', () => {
      const summary = {
        sub: 'u1',
        totalDue: 1,
        books: [{ book: 'Philippians', dueCount: 1, dueRefs: [] }],
      };
      expect(renderReminderEmail(summary, '').subject).toBe('1 chunk due for review today');
    });
  });
});

describe('reminder-dispatch — handler (mocked SDK)', () => {
  beforeEach(() => {
    mockDdbSend.mockReset();
    mockCognitoSend.mockReset();
    mockSesSend.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  function mockScan(items: Record<string, unknown>[]) {
    // 1st ddb call: Scan (no LastEvaluatedKey → single page).
    mockDdbSend.mockImplementation((cmd: { input?: Record<string, unknown> }) => {
      // BatchGet for book names → return an empty responses map (generic label).
      if (cmd && 'input' in cmd && (cmd.input as Record<string, unknown>)?.['RequestItems']) {
        return Promise.resolve({ Responses: { ScrollStudies: [] } });
      }
      return Promise.resolve({ Items: items });
    });
  }

  function mockEmail(sub: string, email: string) {
    mockCognitoSend.mockResolvedValue({ UserAttributes: [{ Name: 'email', Value: email }] });
  }

  it('sends exactly one email to an opted-in due user', async () => {
    mockScan([studyItem('u1', 's1', [ch({ dueDate: '' })]), prefItem('u1', true)]);
    mockEmail('u1', 'u1@example.com');
    mockSesSend.mockResolvedValue({});

    const res = await handler();
    expect(res.sent).toBe(1);
    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const sent = mockSesSend.mock.calls[0][0].input;
    expect(sent.Destination.ToAddresses).toEqual(['u1@example.com']);
    expect(sent.FromEmailAddress).toBe('sender@example.com');
  });

  it('sends NOTHING to an opted-out user', async () => {
    mockScan([studyItem('u1', 's1', [ch({ dueDate: '' })]), prefItem('u1', false)]);
    const res = await handler();
    expect(res.sent).toBe(0);
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('sends NOTHING to a user with no PREFS item (default off)', async () => {
    mockScan([studyItem('u1', 's1', [ch({ dueDate: '' })])]);
    const res = await handler();
    expect(res.sent).toBe(0);
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('sends NOTHING to an opted-in user with nothing due', async () => {
    mockScan([studyItem('u1', 's1', [ch({ dueDate: '2026-12-01' })]), prefItem('u1', true)]);
    const res = await handler();
    expect(res.sent).toBe(0);
    expect(mockSesSend).not.toHaveBeenCalled();
  });

  it('skips a user whose email cannot be resolved, without aborting the run', async () => {
    mockScan([
      studyItem('u1', 's1', [ch({ dueDate: '' })]),
      prefItem('u1', true),
      studyItem('u2', 's2', [ch({ dueDate: '' })]),
      prefItem('u2', true),
    ]);
    // u1 has no email attribute; u2 resolves fine.
    mockCognitoSend.mockImplementation((cmd: { input?: { Username?: string } }) => {
      if (cmd.input?.Username === 'u1') return Promise.resolve({ UserAttributes: [] });
      return Promise.resolve({ UserAttributes: [{ Name: 'email', Value: 'u2@example.com' }] });
    });
    mockSesSend.mockResolvedValue({});

    const res = await handler();
    expect(res.sent).toBe(1);
    expect(res.skipped).toBe(1);
    expect(mockSesSend).toHaveBeenCalledTimes(1);
  });

  it('continues when one SES send throws', async () => {
    mockScan([
      studyItem('u1', 's1', [ch({ dueDate: '' })]),
      prefItem('u1', true),
      studyItem('u2', 's2', [ch({ dueDate: '' })]),
      prefItem('u2', true),
    ]);
    mockCognitoSend.mockResolvedValue({
      UserAttributes: [{ Name: 'email', Value: 'x@example.com' }],
    });
    mockSesSend.mockRejectedValueOnce(new Error('SES throttled')).mockResolvedValueOnce({});

    const res = await handler();
    expect(res.sent).toBe(1);
    expect(res.skipped).toBe(1);
  });
});
