# RAG memory indexing notes

This branch is the local experiment area for RAG DB/indexing work:

- Branch: `feature/rag-context-on-latest-main`
- Do not merge or push unless explicitly requested.
- Keep STT/chatbot provider integration separate so teammates can wire those APIs without touching indexing internals.

## What this adds

The current app stores raw meeting data in:

- `meetings`
- `transcripts`
- `notes`
- `photos`

This experiment adds RAG-facing tables:

- `meeting_memory_chunks`: searchable evidence chunks from meeting metadata, transcript text, notes, and board/photo captures.
- `memory_extractions`: future structured outputs such as decisions, TODOs, open questions, summaries, and board assets.
- `chat_sessions`: one stable ID per `/ask` conversation.
- `chat_messages`: user/assistant turns with answer sources.
- `meeting_chat_context_selections`: selected chat IDs to use as meeting summary context.

Run `supabase-rag-schema.sql` after the original `supabase-schema.sql`.

The latest upstream STT/OCR/photo features are preserved. The only meeting-detail
UI insertion from this branch is `MeetingChatContextPanel`, placed directly under
`TranscriptRefinePanel`.

## Experimental API

Open the local UI:

```text
http://localhost:3000/rag
```

User-facing chatbot UI:

```text
http://localhost:3000/ask
```

`/ask` has three explicit modes:

- `RAG`: searches local meeting memory chunks and answers from those chunks only.
- `웹 검색`: uses the OpenAI Responses API web search tool, without local meeting-memory retrieval.
- `Plain`: uses only the current chat history and latest user message for analysis/discussion.

If `.env.local` is missing, the UI/API automatically uses built-in dummy
meetings so the retrieval flow can be tested without Supabase.

Index one meeting:

```bash
curl -X POST http://localhost:3000/api/rag/index-meeting \
  -H 'Content-Type: application/json' \
  -d '{"meetingId":"<meeting-id>"}'
```

Preview chunks without writing:

```bash
curl -X POST http://localhost:3000/api/rag/index-meeting \
  -H 'Content-Type: application/json' \
  -d '{"meetingId":"<meeting-id>","dryRun":true}'
```

Search indexed chunks:

```bash
curl -X POST http://localhost:3000/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{"question":"왜 GSM8K 우선순위를 낮췄지?","limit":8}'
```

Ask the LLM with retrieved evidence:

```bash
curl -X POST http://localhost:3000/api/rag/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"왜 GSM8K 우선순위를 낮췄지?","limit":5,"chatId":"chat_local_test"}'
```

Disable similarity sorting:

```bash
curl -X POST http://localhost:3000/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{"question":"왜 GSM8K 우선순위를 낮췄지?","limit":8,"sortBySimilarity":false}'
```

## OpenAI API key handling

`/api/ask` and `/api/rag/chat` read OpenAI credentials only on the server:

- `OPENAI_API_KEY`: required for real LLM answers.
- `OPENAI_MODEL`: optional, defaults to `gpt-5.4-mini` for this local experiment.
- `OPENAI_WEB_SEARCH_MODEL`: optional override for `/api/ask` when web search is enabled.

For one terminal session:

```bash
export OPENAI_API_KEY='replace-with-your-key'
export OPENAI_MODEL='gpt-5.4-mini'
export OPENAI_WEB_SEARCH_MODEL='gpt-5.5'
```

For local Next.js development, `.env.local` is also fine because this repo's
`.gitignore` excludes `.env*`:

```bash
OPENAI_API_KEY=replace-with-your-key
OPENAI_MODEL=gpt-5.4-mini
OPENAI_WEB_SEARCH_MODEL=gpt-5.5
```

Never use `NEXT_PUBLIC_OPENAI_API_KEY`. `NEXT_PUBLIC_*` values are bundled for
browser use, while the OpenAI key must stay server-only. If `OPENAI_API_KEY` is
missing, the chat routes return a local evidence-only fallback so the UI remains
testable without a provider call.

Each `/ask` response can carry:

- `chatId`: the stable chat session ID.
- `user_message_id`: the stored user turn ID.
- `assistant_message_id`: the stored assistant turn ID.

The meeting detail page lists stored chat sessions under the STT panel. Selecting
one or more chat IDs writes rows into `meeting_chat_context_selections`, so a
later meeting summary API can pull the chosen conversations into its context.

Current local scoring is `hybrid-bm25-charngram-v1`:

- `45%` BM25 over chunk content plus title/project/tag context.
- `35%` character n-gram TF-IDF cosine, useful for Korean suffix/spacing variants.
- `10%` phrase/token coverage.
- `7%` title/project/tag field match.
- `3%` intent-kind boost, e.g. "왜/결정" prefers decision-like chunks.

This is a no-provider baseline. Once embeddings are available, replace or
combine the `char_ngram` part with dense embedding cosine and optionally add a
reranker.

## Next work for this branch

1. Feed selected `meeting_chat_context_selections` into the meeting summary/refine endpoint.
2. Add LLM extraction into `memory_extractions` for decisions, TODOs, and open questions.
3. Add embedding generation after the chatbot/STT API owner chooses the provider.
4. Extend `/api/ask` RAG mode to also retrieve from `memory_extractions`.
5. Add board image analysis into `memory_extractions` with `extraction_type = 'board_asset'`.
