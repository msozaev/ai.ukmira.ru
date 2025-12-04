import { NextRequest, NextResponse } from "next/server";
import { generateSummary } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const summary = await generateSummary(text);
    return NextResponse.json({ summary });
  } catch (error: unknown) {
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
  }
}
