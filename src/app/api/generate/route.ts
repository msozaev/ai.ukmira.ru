import { NextRequest, NextResponse } from "next/server";
import { runGemini, type Source, type StudioMode, type ChatMessage } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60; // seconds, to allow slower Gemini calls

type Body = {
  mode: StudioMode;
  prompt: string;
  sources: Source[];
  history?: ChatMessage[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.prompt || !body?.mode) {
      return NextResponse.json({ error: "mode и prompt обязательны" }, { status: 400 });
    }

    const result = await runGemini({
      mode: body.mode,
      prompt: body.prompt,
      sources: body.sources || [],
      history: body.history || [],
    });

    return NextResponse.json({ text: result });
  } catch (error: unknown) {
    console.error("/api/generate", error);
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
