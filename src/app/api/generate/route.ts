import { NextRequest, NextResponse } from "next/server";
import { runGemini, generateImage, type Source, type StudioMode, type ChatMessage } from "@/lib/gemini";

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

    if (body.mode === "infographic") {
      // 1. Generate a visual description prompt
      const visualPrompt = await runGemini({
        mode: "chat", // Use chat mode to get a description
        prompt: `Create a detailed visual description for an infographic based on the provided sources. 
        Focus on layout, colors, key data points, and visual elements. 
        The description should be suitable for an image generation model. 
        Keep it under 100 words. 
        Context: ${body.prompt}`,
        sources: body.sources || [],
        history: [],
      });

      // 2. Generate the image
      const base64Image = await generateImage(visualPrompt);
      return NextResponse.json({ image: base64Image, text: "Инфографика сгенерирована" });
    }

    if (body.mode === "video") {
      const scriptRaw = await runGemini({
        mode: body.mode,
        prompt: body.prompt,
        sources: body.sources || [],
        history: body.history || [],
      });

      // Robust JSON extraction: find first '{' and last '}'
      const start = scriptRaw.indexOf("{");
      const end = scriptRaw.lastIndexOf("}");
      const jsonCandidate = (start >= 0 && end > start) 
        ? scriptRaw.slice(start, end + 1) 
        : scriptRaw.replace(/```json|```/gi, "").trim();

      let scriptData;
      try {
        scriptData = JSON.parse(jsonCandidate);
      } catch (e) {
        console.error("JSON Parse Error", e);
        // If JSON parsing fails, return the raw text so the user at least sees the script
        return NextResponse.json({ text: scriptRaw });
      }

      if (!scriptData?.scenes || !Array.isArray(scriptData.scenes)) {
        return NextResponse.json({ text: scriptRaw });
      }

      // Generate images for scenes in parallel
      const scenesWithImages = await Promise.all(
        scriptData.scenes.map(async (scene: { text: string; visual: string }) => {
          try {
            const img = await generateImage(scene.visual + " cinematic lighting, high detail, 4k");
            return { ...scene, image: img };
          } catch (e) {
            console.error("Image Gen Error for scene", scene.visual, e);
            return { ...scene, image: null };
          }
        })
      );

      return NextResponse.json({
        video: {
          title: scriptData.title || "Видеопересказ",
          scenes: scenesWithImages,
        },
        text: "Видео готово к просмотру.",
      });
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
