import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
