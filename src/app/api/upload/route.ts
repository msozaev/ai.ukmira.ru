import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
// Explicit worker path to avoid Turbopack chunk lookup
GlobalWorkerOptions.workerSrc = path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
import { v4 as uuid } from "uuid";
import { type Source, generateSummary } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

async function extractPdfText(buffer: Buffer) {
  // pdfjs runs in-process in the Node.js runtime; no web worker needed.
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const maxPages = Math.min(pdf.numPages, 20); // keep memory in check
  const parts: string[] = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    parts.push(pageText);
  }
  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files").filter(Boolean) as File[];

    if (!files.length) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 400 });
    }

    const sources: Source[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      let content = "";

      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        content = await extractPdfText(buffer);
      } else {
        content = buffer.toString("utf-8");
      }

      const summary = await generateSummary(content);

      sources.push({
        id: uuid(),
        title: file.name,
        type: "file",
        content,
        summary,
      });
    }

    return NextResponse.json({ sources });
  } catch (error: unknown) {
    console.error("/api/upload", error);
    const message = error instanceof Error ? error.message : "Ошибка загрузки";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
