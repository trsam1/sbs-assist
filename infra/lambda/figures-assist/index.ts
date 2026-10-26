import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { FigureCandidate } from '../shared/models';
import { corsResponse, getRequestOrigin } from '../shared/cors';

const bedrockClient = new BedrockRuntimeClient({});
/**
 * The assist model is per-stage (prod Opus 5.5, dev Sonnet 5.5), injected by CDK from
 * StageConfig.figuresAssistModelId — a stronger tier than Step 5's Haiku because figure
 * candidate-spotting and tag-checking are judgment tasks. Read per call so tests can stub it.
 */
function modelId(): string {
  return process.env['FIGURES_ASSIST_MODEL_ID'] ?? '';
}

/** Bound the student scroll text sent in a prompt (same cap as the stored scroll text). */
const SCROLL_TEXT_CAP = 350_000;

interface APIGatewayEvent {
  httpMethod: string;
  resource: string;
  body?: string | null;
  headers?: Record<string, string | undefined> | null;
}

interface BedrockResponseBody {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Build the "suggest candidates" prompt. Carries ONLY the student's own scroll text, their own
 * notes, and the fixed taxonomy names — never app-fetched Bible text. Instructs the model to
 * return locations + a type to consider + a short reason, and explicitly NEVER an interpretation.
 */
export function buildSuggestPrompt(
  scrollText: string,
  notes: string,
  typeNames: readonly string[],
): string {
  return `You are a Bible-study assistant helping a student with Step 10 of an inductive study — identifying figures of speech and Hebrew-poetry parallelism in a book they are studying.

You will be shown the student's own scroll text (a book of the Bible they provided). Scan it and surface up to 8 CANDIDATE passages that MAY contain a figure of speech or parallelism worth the student's attention.

Hard rules:
- Return ONLY candidates to consider — locations to look at, each with ONE figure type to consider and ONE short reason to look there.
- NEVER provide an interpretation of the passage or state what it means. You surface where to look; the student decides.
- Be conservative: a candidate should have a real surface signal. If the plain sense is literal, do not invent a figure. If few or none stand out, return few or none.
- The "suggestedType" MUST be one of these taxonomy ids: ${typeNames.join(', ')}.

Respond with ONLY a JSON array (no prose, no code fence) of objects, each exactly:
{"reference": "<location, e.g. 2:6-11>", "suggestedType": "<one taxonomy id>", "reason": "<one short clause, no interpretation>"}

Student's notes (may be empty): ${notes || 'None'}

Scroll text:
${scrollText}`;
}

/**
 * Build the "check my tag" prompt. Carries ONLY the student's chosen type, their reference, and
 * their own transcription/paraphrase. Instructs the model to ADVISE, not decide, and to name the
 * student as the final judge.
 */
export function buildCheckPrompt(figureType: string, reference: string, text: string): string {
  return `You are a Bible-study consultant giving a SECOND OPINION on a student's Step 10 work (figures of speech / parallelism).

The student tagged a passage with a figure type. Give a brief, opinionated second read: does the chosen type seem to fit, and if not, which type it reads more like and WHY. Two to four sentences.

Hard rules:
- You ADVISE; you do not decide. End by making clear the student is the final judge of their own text.
- Do NOT rewrite their interpretation or tell them the passage's meaning — comment only on whether the TYPE fits.
- Keep it short and plain.

Student's chosen type: ${figureType}
Passage reference: ${reference}
Student's own transcription/paraphrase (may be empty): ${text || 'None provided'}`;
}

/** Parse the model's suggest output into candidates, tolerating a stray code fence or prose. */
export function parseCandidates(raw: string): FigureCandidate[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: FigureCandidate[] = [];
  for (const el of arr) {
    if (!el || typeof el !== 'object') continue;
    const { reference, suggestedType, reason } = el as Record<string, unknown>;
    if (typeof reference !== 'string' || reference.trim().length === 0) continue;
    out.push({
      reference,
      suggestedType: typeof suggestedType === 'string' ? suggestedType : '',
      reason: typeof reason === 'string' ? reason : '',
    });
  }
  return out;
}

async function invokeModel(prompt: string, maxTokens: number): Promise<string> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: modelId(),
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    }),
  );
  const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as BedrockResponseBody;
  return responseBody.content?.[0]?.text?.trim() ?? '';
}

const DEGRADED_MESSAGE = 'The AI assist is unavailable right now. Please try again in a moment.';

export const handler = async (event: APIGatewayEvent) => {
  const origin = getRequestOrigin(event.headers);

  if (!event.body) {
    return corsResponse(400, { message: 'Request body is required.' }, origin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return corsResponse(400, { message: 'Invalid JSON in request body.' }, origin);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return corsResponse(400, { message: 'Invalid request body.' }, origin);
  }
  const body = parsed as Record<string, unknown>;

  const action = body['action'];
  if (action !== 'suggest' && action !== 'check') {
    return corsResponse(400, { message: 'action must be "suggest" or "check".' }, origin);
  }

  if (action === 'suggest') {
    const scrollText = body['scrollText'];
    if (typeof scrollText !== 'string' || scrollText.trim().length === 0) {
      return corsResponse(400, { message: 'scrollText is required.' }, origin);
    }
    const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
    const types = Array.isArray(body['types'])
      ? (body['types'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    try {
      const out = await invokeModel(
        buildSuggestPrompt(scrollText.slice(0, SCROLL_TEXT_CAP), notes, types),
        1024,
      );
      return corsResponse(200, { candidates: parseCandidates(out) }, origin);
    } catch (err: unknown) {
      console.error('Bedrock suggest failed:', err);
      return corsResponse(
        200,
        { candidates: [], degraded: true, message: DEGRADED_MESSAGE },
        origin,
      );
    }
  }

  // action === 'check'
  const figureType = body['figureType'];
  const reference = body['reference'];
  if (typeof figureType !== 'string' || figureType.trim().length === 0) {
    return corsResponse(400, { message: 'figureType is required.' }, origin);
  }
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    return corsResponse(400, { message: 'reference is required.' }, origin);
  }
  const text = typeof body['text'] === 'string' ? body['text'] : '';
  try {
    const advice = await invokeModel(buildCheckPrompt(figureType, reference, text), 512);
    return corsResponse(200, { advice }, origin);
  } catch (err: unknown) {
    console.error('Bedrock check failed:', err);
    return corsResponse(200, { advice: '', degraded: true, message: DEGRADED_MESSAGE }, origin);
  }
};
