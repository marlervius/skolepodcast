import { NextResponse } from "next/server";
import { handle } from "@/lib/auth";
import { ping } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Kalles daglig av Vercel Cron (vercel.json) så gratisprosjektet hos Supabase ikke settes på pause. */
export async function GET() {
  return handle(async () => {
    await ping();
    return NextResponse.json({ ok: true });
  });
}
