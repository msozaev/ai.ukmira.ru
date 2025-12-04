import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";
import { v4 as uuid } from "uuid";
import { type Source, generateSummary } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 40;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: "Нужен url" }, { status: 400 });
    }

    const res = await fetch(url);
    const html = await res.text();
    const $ = load(html);
    $("script, style, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    const title = $("title").text().trim() || url;

    const summary = await generateSummary(text);

    const source: Source = {
      id: uuid(),
      title,
      type: "link",
      url,
      content: text.slice(0, 20000),
      summary,
    };

    return NextResponse.json({ source });
  } catch (error: unknown) {
    console.error("/api/link", error);
    const message = error instanceof Error ? error.message : "Не удалось получить ссылку";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
