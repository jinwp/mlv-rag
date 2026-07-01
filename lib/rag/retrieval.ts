import type { MemoryChunkRow, MemoryKind, MemorySearchResult } from "@/lib/rag/types";

const TOKEN_RE = /[A-Za-z0-9가-힣_+-]+/g;
const NGRAM_RE = /[^A-Za-z0-9가-힣]+/g;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const SCORE_WEIGHTS = {
  bm25: 0.45,
  char_ngram: 0.35,
  phrase: 0.1,
  field: 0.07,
  intent: 0.03,
};
const ALGORITHM = "hybrid-bm25-charngram-v1";

const STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "for",
  "with",
  "that",
  "this",
  "what",
  "why",
  "어떤",
  "뭐였지",
  "왜",
  "지난번",
  "관련",
  "회의",
]);

const INTENT_KIND_BOOSTS: Record<string, MemoryKind[]> = {
  decision: ["decision", "summary", "raw_transcript", "note"],
  todo: ["todo", "note", "summary", "raw_transcript"],
  question: ["open_question", "note", "raw_transcript"],
  board: ["board_capture", "summary", "note"],
};

type MeetingInfo = {
  title: string | null;
  date: string | null;
  project_tag: string | null;
};

type PreparedChunk = {
  chunk: MemoryChunkRow;
  meeting: MeetingInfo;
  searchText: string;
  fieldText: string;
  tokens: string[];
  tokenCounts: Map<string, number>;
  docLength: number;
  charNgrams: string[];
  charCounts: Map<string, number>;
};

type RawScore = {
  prepared: PreparedChunk;
  bm25Raw: number;
  charNgram: number;
  phrase: number;
  field: number;
  intent: number;
  matchedTerms: string[];
};

export function tokenize(text: string): string[] {
  return [...new Set(tokenizeAll(text))];
}

function tokenizeAll(text: string): string[] {
  const tokens = text.toLowerCase().match(TOKEN_RE) ?? [];
  return tokens.map(normalizeToken).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function normalizeToken(token: string): string {
  const alphaNumericWithJosa = token.match(/^([a-z0-9_+-]+)[가-힣]+$/);
  if (alphaNumericWithJosa) return alphaNumericWithJosa[1];

  const josa = [
    "으로",
    "에서",
    "에는",
    "에게",
    "부터",
    "까지",
    "보다",
    "처럼",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "와",
    "과",
    "로",
    "도",
    "만",
    "의",
    "에",
  ];
  for (const suffix of josa) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function inferIntents(query: string): string[] {
  const q = query.toLowerCase();
  const intents: string[] = [];
  if (q.includes("왜") || q.includes("결정") || q.includes("reason") || q.includes("decision")) {
    intents.push("decision");
  }
  if (q.includes("todo") || q.includes("할 일") || q.includes("담당") || q.includes("action")) {
    intents.push("todo");
  }
  if (q.includes("open question") || q.includes("질문") || q.includes("이슈")) {
    intents.push("question");
  }
  if (q.includes("보드") || q.includes("수식") || q.includes("diagram") || q.includes("figure")) {
    intents.push("board");
  }
  return intents;
}

function normalizeMeeting(chunk: MemoryChunkRow): MeetingInfo {
  const meeting = Array.isArray(chunk.meetings) ? chunk.meetings[0] : chunk.meetings;
  return {
    title: meeting?.title ?? null,
    date: meeting?.date ?? null,
    project_tag: meeting?.project_tag ?? null,
  };
}

function countTerms(terms: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function normalizeForNgram(text: string): string {
  return text.toLowerCase().normalize("NFKC").replace(NGRAM_RE, "");
}

function charNgrams(text: string): string[] {
  const normalized = normalizeForNgram(text);
  if (!normalized) return [];
  if (normalized.length <= 3) return [normalized];

  const grams: string[] = [];
  for (const n of [2, 3]) {
    for (let i = 0; i <= normalized.length - n; i++) {
      grams.push(normalized.slice(i, i + n));
    }
  }
  return grams;
}

function highlight(content: string, terms: string[]): string[] {
  const sentences = content.split(/(?<=[.!?。！？])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const lowerTerms = terms.map((term) => term.toLowerCase());
  const hits = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return lowerTerms.some((term) => lower.includes(term));
  });
  return (hits.length ? hits : sentences).slice(0, 2);
}

function prepareChunk(chunk: MemoryChunkRow): PreparedChunk {
  const meeting = normalizeMeeting(chunk);
  const tags = chunk.tags ?? [];
  const fieldText = [meeting.title, meeting.project_tag, ...tags].filter(Boolean).join(" ");
  const searchText = [chunk.content, fieldText, fieldText].filter(Boolean).join("\n");
  const tokens = tokenizeAll(searchText);
  const charTerms = charNgrams(searchText);

  return {
    chunk,
    meeting,
    searchText,
    fieldText,
    tokens,
    tokenCounts: countTerms(tokens),
    docLength: Math.max(tokens.length, 1),
    charNgrams: charTerms,
    charCounts: countTerms(charTerms),
  };
}

function buildDocumentFrequency(docs: PreparedChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc.tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

function bm25(queryTerms: string[], doc: PreparedChunk, df: Map<string, number>, docCount: number, avgDocLength: number): number {
  let score = 0;
  for (const term of queryTerms) {
    const tf = doc.tokenCounts.get(term) ?? 0;
    if (tf === 0) continue;

    const termDf = df.get(term) ?? 0;
    const idf = Math.log(1 + (docCount - termDf + 0.5) / (termDf + 0.5));
    const lengthNorm = 1 - BM25_B + BM25_B * (doc.docLength / Math.max(avgDocLength, 1));
    score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm));
  }
  return score;
}

function buildCharIdf(docs: PreparedChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const gram of new Set(doc.charNgrams)) {
      df.set(gram, (df.get(gram) ?? 0) + 1);
    }
  }
  return df;
}

function tfIdfVector(counts: Map<string, number>, idf: Map<string, number>, docCount: number): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [term, tf] of counts) {
    const termIdf = Math.log(1 + docCount / ((idf.get(term) ?? 0) + 1));
    vector.set(term, tf * termIdf);
  }
  return vector;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (const value of a.values()) aNorm += value * value;
  for (const value of b.values()) bNorm += value * value;
  for (const [term, value] of a) dot += value * (b.get(term) ?? 0);

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function phraseScore(query: string, queryTerms: string[], doc: PreparedChunk): number {
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedSearch = doc.searchText.toLowerCase();
  if (normalizedQuery && normalizedSearch.includes(normalizedQuery)) return 1;
  if (queryTerms.length === 0) return 0;

  const matched = queryTerms.filter((term) => normalizedSearch.includes(term)).length;
  const coverage = matched / queryTerms.length;
  const bigrams = queryTerms.slice(0, -1).map((term, index) => `${term} ${queryTerms[index + 1]}`);
  const bigramMatches = bigrams.filter((bigram) => normalizedSearch.includes(bigram)).length;
  const bigramCoverage = bigrams.length ? bigramMatches / bigrams.length : 0;

  return Math.min(1, 0.75 * coverage + 0.25 * bigramCoverage);
}

function fieldScore(queryTerms: string[], doc: PreparedChunk): number {
  if (queryTerms.length === 0) return 0;
  const fieldText = doc.fieldText.toLowerCase();
  const matches = queryTerms.filter((term) => fieldText.includes(term)).length;
  return matches / queryTerms.length;
}

function intentScore(intents: string[], kind: MemoryKind): number {
  if (intents.length === 0) return 0;
  return intents.some((intent) => INTENT_KIND_BOOSTS[intent]?.includes(kind)) ? 1 : 0;
}

function rawScores(query: string, docs: PreparedChunk[]): RawScore[] {
  const queryTerms = tokenize(query);
  const intents = inferIntents(query);
  const docCount = Math.max(docs.length, 1);
  const avgDocLength = docs.reduce((sum, doc) => sum + doc.docLength, 0) / docCount;
  const df = buildDocumentFrequency(docs);
  const charDf = buildCharIdf(docs);
  const queryCharVector = tfIdfVector(countTerms(charNgrams(query)), charDf, docCount);

  return docs.map((doc) => {
    const docCharVector = tfIdfVector(doc.charCounts, charDf, docCount);
    const matchedTerms = queryTerms.filter((term) => doc.searchText.toLowerCase().includes(term));

    return {
      prepared: doc,
      bm25Raw: bm25(queryTerms, doc, df, docCount, avgDocLength),
      charNgram: cosine(queryCharVector, docCharVector),
      phrase: phraseScore(query, queryTerms, doc),
      field: fieldScore(queryTerms, doc),
      intent: intentScore(intents, doc.chunk.memory_kind),
      matchedTerms: [...new Set(matchedTerms)],
    };
  });
}

function toResult(raw: RawScore, bm25Max: number): MemorySearchResult {
  const { chunk, meeting } = raw.prepared;
  const bm25Normalized = bm25Max > 0 ? raw.bm25Raw / bm25Max : 0;
  const weighted =
    SCORE_WEIGHTS.bm25 * bm25Normalized +
    SCORE_WEIGHTS.char_ngram * raw.charNgram +
    SCORE_WEIGHTS.phrase * raw.phrase +
    SCORE_WEIGHTS.field * raw.field +
    SCORE_WEIGHTS.intent * raw.intent;
  const score = Math.round(weighted * 10000) / 100;

  return {
    ...chunk,
    score,
    score_breakdown: {
      algorithm: ALGORITHM,
      bm25: Math.round(bm25Normalized * 10000) / 100,
      char_ngram: Math.round(raw.charNgram * 10000) / 100,
      phrase: Math.round(raw.phrase * 10000) / 100,
      field: Math.round(raw.field * 10000) / 100,
      intent: Math.round(raw.intent * 10000) / 100,
      weights: SCORE_WEIGHTS,
    },
    highlights: highlight(chunk.content, raw.matchedTerms.length ? raw.matchedTerms : tokenize(chunk.content)),
    matched_terms: raw.matchedTerms,
    meeting_title: meeting.title,
    meeting_date: meeting.date,
    project_tag: meeting.project_tag,
  };
}

export function rankMemoryChunks(
  query: string,
  chunks: MemoryChunkRow[],
  options: {
    limit?: number;
    kinds?: MemoryKind[];
    projectTag?: string;
    sortBySimilarity?: boolean;
    includeZero?: boolean;
  } = {}
): MemorySearchResult[] {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
  const prepared = chunks
    .filter((chunk) => {
      if (options.kinds?.length && !options.kinds.includes(chunk.memory_kind)) return false;
      if (options.projectTag) {
        const meeting = normalizeMeeting(chunk);
        if (meeting.project_tag !== options.projectTag) return false;
      }
      return true;
    })
    .map(prepareChunk);

  const raw = rawScores(query, prepared);
  const bm25Max = raw.reduce((max, item) => Math.max(max, item.bm25Raw), 0);
  const scored = raw
    .map((item) => toResult(item, bm25Max))
    .filter(
      (result) =>
        options.includeZero ||
        result.matched_terms.length > 0 ||
        result.score_breakdown.bm25 > 0 ||
        result.score_breakdown.phrase > 0 ||
        result.score_breakdown.field > 0 ||
        result.score_breakdown.char_ngram > 12
    );

  if (options.sortBySimilarity === false) {
    return scored
      .sort((a, b) => {
        const dateCompare = (b.meeting_date ?? "").localeCompare(a.meeting_date ?? "");
        if (dateCompare !== 0) return dateCompare;
        const aStart = a.start_seconds ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.start_seconds ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) return aStart - bStart;
        return a.chunk_index - b.chunk_index;
      })
      .slice(0, limit);
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.meeting_date ?? "").localeCompare(a.meeting_date ?? "");
    })
    .slice(0, limit);
}
