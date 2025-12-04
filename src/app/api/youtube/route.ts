import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import { v4 as uuid } from "uuid";
import { type Source, generateSummary } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 40;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: "Нужна ссылка на YouTube" }, { status: 400 });
    }

    const transcript = await YoutubeTranscript.fetchTranscript(url);
    const content = transcript.map((t) => t.text).join(" ");

    const summary = await generateSummary(content);

    const source: Source = {
      id: uuid(),
      title: "YouTube",
      type: "youtube",
      url,
      content: content.slice(0, 20000),
      summary,
    };

    return NextResponse.json({ source });
  } catch (error: unknown) {
    console.error("/api/youtube", error);
    const message = error instanceof Error ? error.message : "Не удалось получить расшифровку";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
