/**
 * STT (speech-to-text) placeholder.
 *
 * A teammate will later replace ONLY the body of this function with a real STT
 * call (e.g. upload `audioPath` to Whisper / a hosted STT endpoint and return
 * the transcribed text). The signature is intentionally kept stable so callers
 * (the /record "종료 및 저장" flow) don't need to change.
 *
 * @param audioPath Supabase Storage path of the recorded audio.
 * @returns The full transcript text to store in `transcripts.full_text`.
 */
export async function mockTranscribe(audioPath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _audioPath = audioPath;
  return "[STT 연동 대기 중]";
}
