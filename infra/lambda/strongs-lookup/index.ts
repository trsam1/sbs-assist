import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { CrossReference } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';
import { validateStrongsNumber } from '../shared/validation';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env['STRONGS_TABLE_NAME'] ?? '';

interface APIGatewayEvent {
  httpMethod: string;
  resource: string;
  pathParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined> | null;
}

interface StrongsStudyResult {
  strongsNumber: string;
  definition: string;
  originalWord: string;
  transliteration: string;
  lexiconEntry: string;
}

async function getStrongsStudyData(
  strongsNumber: string,
): Promise<StrongsStudyResult> {
  const pk = `STRONGS#${strongsNumber}`;

  const [defResult, lexResult] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: tableName, Key: { PK: pk, SK: 'DEF' } }),
    ),
    docClient.send(
      new GetCommand({ TableName: tableName, Key: { PK: pk, SK: 'LEXICON' } }),
    ),
  ]);

  return {
    strongsNumber,
    definition: defResult.Item?.['definition'] ?? 'Definition not available',
    originalWord: defResult.Item?.['originalWord'] ?? '',
    transliteration: defResult.Item?.['transliteration'] ?? '',
    lexiconEntry:
      lexResult.Item?.['lexiconEntry'] ?? 'Lexicon entry not available',
  };
}

async function getCrossReferences(
  strongsNumber: string,
): Promise<CrossReference[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `STRONGS#${strongsNumber}`,
        ':prefix': 'XREF#',
      },
    }),
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item) => ({
    reference: item['reference'] as string,
    notes: '',
  }));
}

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);
  const strongsNumber = event.pathParameters?.['strongsNumber'];

  if (!strongsNumber || !validateStrongsNumber(strongsNumber)) {
    return corsResponse(400, {
      message: 'Invalid Strong\'s number. Expected format: G25 or H157',
    }, origin);
  }

  try {
    if (event.resource.endsWith('/cross-references')) {
      const data = await getCrossReferences(strongsNumber);
      return corsResponse(200, data, origin);
    }

    const data = await getStrongsStudyData(strongsNumber);
    return corsResponse(200, data, origin);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Internal server error';
    return corsResponse(500, { message }, origin);
  }
};
