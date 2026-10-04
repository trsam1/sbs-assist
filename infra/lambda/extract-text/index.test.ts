import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCROLL_TEXT_LIMIT } from '../shared/models';

const { mockSend, mockS3Send, mockExtractText } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockS3Send: vi.fn(),
  mockExtractText: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class MockDynamoDBClient {},
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  UpdateCommand: class MockUpdateCommand {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = mockS3Send;
  },
  GetObjectCommand: class MockGetObjectCommand {
    constructor(public input: unknown) {}
  },
  HeadObjectCommand: class MockHeadObjectCommand {
    constructor(public input: unknown) {}
  },
}));
vi.mock('./extract', () => ({ extractText: mockExtractText }));

vi.stubEnv('SCROLL_STUDIES_TABLE_NAME', 'ScrollStudies');

import { handler } from './index';

/** A GetObject result whose Body streams the given buffer, matching the SDK v3 shape. */
function s3Body(buf: Buffer) {
  return { Body: { transformToByteArray: async () => new Uint8Array(buf) } };
}

function s3Event(key: string, size?: number) {
  return {
    Records: [
      {
        s3: {
          bucket: { name: 'uploads-bucket' },
          object: size === undefined ? { key } : { key, size },
        },
      },
    ],
  };
}

/** Pull the status written on the Nth UpdateCommand send call. */
function statusOfCall(callIndex: number): string | undefined {
  const input = mockSend.mock.calls[callIndex][0].input as {
    ExpressionAttributeValues?: Record<string, unknown>;
  };
  return input.ExpressionAttributeValues?.[':status'] as string | undefined;
}

describe('Extract Text Lambda', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockS3Send.mockReset();
    mockExtractText.mockReset();
  });

  it('moves uploading→extracting→ready and stores extracted text', async () => {
    mockSend.mockResolvedValue({}); // all UpdateCommands
    mockS3Send.mockResolvedValueOnce(s3Body(Buffer.from('In the beginning', 'utf8'))); // GetObject
    mockExtractText.mockResolvedValueOnce({ ok: true, text: 'In the beginning' });

    await handler(s3Event('uploads/u1/s1.txt', 10));

    expect(statusOfCall(0)).toBe('extracting');
    const readyInput = mockSend.mock.calls[1][0].input as {
      Key: Record<string, unknown>;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(readyInput.ExpressionAttributeValues[':status']).toBe('ready');
    expect(readyInput.ExpressionAttributeValues[':scrollText']).toBe('In the beginning');
    expect(readyInput.ExpressionAttributeValues[':truncated']).toBe(false);
    expect(readyInput.Key['PK']).toBe('USER#u1');
    expect(readyInput.Key['SK']).toBe('SCROLL#s1');
  });

  it('fails with "file too large" for an oversized object and never downloads it', async () => {
    mockSend.mockResolvedValue({});
    await handler(s3Event('uploads/u1/s1.pdf', SCROLL_TEXT_LIMIT + 11 * 1024 * 1024));

    expect(statusOfCall(0)).toBe('extracting');
    const failInput = mockSend.mock.calls[1][0].input as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(failInput.ExpressionAttributeValues[':status']).toBe('failed');
    expect(failInput.ExpressionAttributeValues[':failureReason']).toBe('file too large');
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockExtractText).not.toHaveBeenCalled();
  });

  it('marks the study failed with the extractor reason', async () => {
    mockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValueOnce(s3Body(Buffer.from('%PDF image only')));
    mockExtractText.mockResolvedValueOnce({ ok: false, reason: 'No extractable text.' });

    await handler(s3Event('uploads/u1/s1.pdf', 20));

    const failInput = mockSend.mock.calls[1][0].input as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(failInput.ExpressionAttributeValues[':status']).toBe('failed');
    expect(failInput.ExpressionAttributeValues[':failureReason']).toBe('No extractable text.');
  });

  it('truncates text at the limit boundary and marks truncated=true', async () => {
    mockSend.mockResolvedValue({});
    const long = 'a'.repeat(SCROLL_TEXT_LIMIT + 500);
    mockS3Send.mockResolvedValueOnce(s3Body(Buffer.from('src')));
    mockExtractText.mockResolvedValueOnce({ ok: true, text: long });

    await handler(s3Event('uploads/u1/s1.txt', 10));

    const readyInput = mockSend.mock.calls[1][0].input as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    const stored = readyInput.ExpressionAttributeValues[':scrollText'] as string;
    expect(Buffer.byteLength(stored, 'utf8')).toBe(SCROLL_TEXT_LIMIT);
    expect(stored.length).toBe(SCROLL_TEXT_LIMIT);
    expect(readyInput.ExpressionAttributeValues[':truncated']).toBe(true);
  });

  it('keeps truncated=false when text is exactly at the limit', async () => {
    mockSend.mockResolvedValue({});
    const exact = 'b'.repeat(SCROLL_TEXT_LIMIT);
    mockS3Send.mockResolvedValueOnce(s3Body(Buffer.from('src')));
    mockExtractText.mockResolvedValueOnce({ ok: true, text: exact });

    await handler(s3Event('uploads/u1/s1.txt', 10));

    const readyInput = mockSend.mock.calls[1][0].input as {
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(readyInput.ExpressionAttributeValues[':truncated']).toBe(false);
    expect((readyInput.ExpressionAttributeValues[':scrollText'] as string).length).toBe(
      SCROLL_TEXT_LIMIT,
    );
  });

  it('uses HeadObject for size when the event omits object.size', async () => {
    mockSend.mockResolvedValue({});
    mockS3Send
      .mockResolvedValueOnce({ ContentLength: 12 }) // HeadObject
      .mockResolvedValueOnce(s3Body(Buffer.from('short text'))); // GetObject
    mockExtractText.mockResolvedValueOnce({ ok: true, text: 'short text' });

    await handler(s3Event('uploads/u1/s1.txt'));

    expect(statusOfCall(1)).toBe('ready');
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('logs and ignores a key that does not match the expected shape', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler(s3Event('uploads/u1/notanid', 10));
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores a key missing the uploads/<user>/<id>.<ext> prefix', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler(s3Event('other/u1/s1.pdf', 10));
    expect(mockSend).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('processes every record in a multi-record event', async () => {
    mockSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue(s3Body(Buffer.from('text')));
    mockExtractText.mockResolvedValue({ ok: true, text: 'text' });

    await handler({
      Records: [
        { s3: { bucket: { name: 'b' }, object: { key: 'uploads/u1/a.txt', size: 4 } } },
        { s3: { bucket: { name: 'b' }, object: { key: 'uploads/u1/b.txt', size: 4 } } },
      ],
    });

    // Two records × (extracting + ready) = 4 DynamoDB updates.
    expect(mockSend).toHaveBeenCalledTimes(4);
  });
});
