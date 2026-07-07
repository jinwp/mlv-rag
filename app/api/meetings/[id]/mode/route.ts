import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { normalizeMeetingMode } from "@/lib/meetings/modes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type PatchBody = {
  mode?: string | null;
};

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function PATCH(req: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!id) {
    return jsonError("meeting id is required");
  }

  let body: PatchBody = {};

  try {
    body = await req.json();
  } catch {
    return jsonError("request body must be JSON");
  }

  const mode = normalizeMeetingMode(body.mode);

  const { data, error } = await supabase
    .from("meetings")
    .update({ mode })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return jsonError("failed to update meeting mode", 500, error.message);
  }

  return NextResponse.json({
    ok: true,
    meeting: data,
  });
}