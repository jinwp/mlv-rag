import { createClient } from "@supabase/supabase-js";

// Values are read from environment variables — never hardcode them.
// Put NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Surfaced in the terminal / browser console so a missing .env.local is obvious.
  console.warn(
    "[lab-rag] Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

export const MEDIA_BUCKET = "meeting-media";

// Fall back to a harmless placeholder so `createClient` doesn't throw at import
// time before .env.local is set up — pages still render, requests just no-op.
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);

/** Resolve a Storage object path into a public URL for <img>/<audio> src. */
export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
