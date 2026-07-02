import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import type { Meeting } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("meetings")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<Meeting[]>();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      meetings: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed to load meetings",
        detail: errorMessage(error),
      },
      { status: 500 }
    );
  }
}
