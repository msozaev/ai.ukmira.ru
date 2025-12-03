import { NextRequest, NextResponse } from "next/server";
import { generateSpeech } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const audioBuffer = await generateSpeech(text);

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: unknown) {
    console.error("/api/tts", error);
    return NextResponse.json({ error: "Speech generation failed" }, { status: 500 });
  }
}
