/**
 * Word-level alignment of a recitation transcript against the verse text, for display.
 * Pure (no Angular), unit-tested. Matching is on normalized words (lowercase, punctuation
 * stripped); display tokens keep the original casing and punctuation.
 */

export interface DiffToken {
  /** The word as it should be displayed (original casing/punctuation). */
  text: string;
  /** Verse words: false when the student did not say it. Transcript words: false when not in the verse. */
  matched: boolean;
}

export interface ReciteDiff {
  /** The verse, word by word, with missed words flagged. */
  verse: DiffToken[];
  /** The transcript, word by word, with words not in the verse flagged. */
  said: DiffToken[];
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Split into display words, dropping tokens that normalize to nothing (e.g. a lone dash). */
function displayWords(text: string): { text: string; norm: string }[] {
  return text
    .split(/\s+/)
    .map((w) => ({ text: w, norm: normalizeWord(w) }))
    .filter((w) => w.norm.length > 0);
}

export function reciteDiff(verseText: string, transcript: string): ReciteDiff {
  const a = displayWords(verseText);
  const b = displayWords(transcript);
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1].norm === b[j - 1].norm
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const matchedA = new Array<boolean>(m).fill(false);
  const matchedB = new Array<boolean>(n).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1].norm === b[j - 1].norm) {
      matchedA[i - 1] = true;
      matchedB[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Verse numbers and other bare numerals in the scroll text are not reliably spoken the same way
  // ("1" vs "one"), so they are never flagged as missed.
  const isNumeral = (norm: string) => /^\d+$/.test(norm);
  return {
    verse: a.map((w, idx) => ({ text: w.text, matched: matchedA[idx] || isNumeral(w.norm) })),
    said: b.map((w, idx) => ({ text: w.text, matched: matchedB[idx] })),
  };
}
