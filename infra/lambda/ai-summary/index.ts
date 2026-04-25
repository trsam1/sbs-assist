import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { WordStudyEntry } from '../shared/models';
import { corsResponse } from '../shared/cors';

const bedrockClient = new BedrockRuntimeClient({});
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

interface APIGatewayEvent {
  httpMethod: string;
  resource: string;
  body?: string | null;
}

interface BedrockResponseBody {
  content?: Array<{ type: string; text?: string }>;
}

function buildPrompt(entry: WordStudyEntry): string {
  const userObservations = entry.crossReferences
    .filter((ref) => ref.notes.trim().length > 0)
    .map((ref) => `${ref.reference}: ${ref.notes}`)
    .join('\n');

  return `You are a Bible study assistant. Synthesize the following word study data into a concise, insightful summary paragraph (3-5 sentences). Focus on what this word means in its original language and how the user's cross-reference observations illuminate its usage across Scripture.

Word: "${entry.word}"
Strong's Number: ${entry.strongsNumber}
Strong's Definition: ${entry.strongsDefinition}
Original Word: ${entry.originalWord} (${entry.transliteration})
Lexicon Entry: ${entry.lexiconEntry}
English Definition: ${entry.englishDefinition}
User's Cross-Reference Observations:
${userObservations || 'None provided'}
User's General Notes: ${entry.notes || 'None'}

Provide a summary that helps the student understand the depth and nuance of this word in its biblical context.`;
}

export async function generateStudySummary(
  entry: WordStudyEntry,
): Promise<string> {
  try {
    const prompt = buildPrompt(entry);

    const response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      }),
    );

    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body),
    ) as BedrockResponseBody;

    const text = responseBody.content?.[0]?.text?.trim();
    if (text && text.length > 0) {
      return text;
    }

    return 'AI summary unavailable. Please try again later.';
  } catch (err: unknown) {
    console.error('Bedrock invocation failed:', err);
    return 'AI summary unavailable. Please try again later.';
  }
}

export const handler = async (event: APIGatewayEvent) => {
  if (!event.body) {
    return corsResponse(400, { message: 'Request body is required' });
  }

  let entry: WordStudyEntry;
  try {
    entry = JSON.parse(event.body) as WordStudyEntry;
  } catch {
    return corsResponse(400, { message: 'Invalid JSON in request body' });
  }

  if (!entry.word || !entry.strongsNumber || !entry.strongsDefinition) {
    return corsResponse(400, {
      message:
        'Missing required fields: word, strongsNumber, and strongsDefinition are required',
    });
  }

  const summary = await generateStudySummary(entry);
  return corsResponse(200, { summary });
};
