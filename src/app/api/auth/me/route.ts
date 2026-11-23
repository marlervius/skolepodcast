import { NextResponse } from "next/server";
import { currentTeacher, handle } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => NextResponse.json({ teacher: await currentTeacher() }));
}
