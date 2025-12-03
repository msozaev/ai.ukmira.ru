import { NextRequest, NextResponse } from "next/server";
import { runGemini, generateImage, generateSpeech, type Source, type StudioMode, type ChatMessage } from "@/lib/gemini";

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
      let jsonCandidate = (start >= 0 && end > start) 
        ? scriptRaw.slice(start, end + 1) 
        : scriptRaw.replace(/```json|```/gi, "").trim();

      // Attempt to fix common JSON issues from LLMs
      jsonCandidate = jsonCandidate
        .replace(/,\s*}/g, "}") // Remove trailing commas
        .replace(/,\s*]/g, "]"); // Remove trailing commas in arrays

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

      // Generate images AND audio for scenes in parallel
      const scenesWithMedia = await Promise.all(
        scriptData.scenes.map(async (scene: { text: string; visual: string }) => {
          const mediaPromises: Promise<any>[] = [];
          
          // 1. Image Generation
          const imagePromise = generateImage(`Create a presentation slide. 
            Visual style: Modern, minimalist, educational, clean vector graphics, white background.
            Content: ${scene.visual}
            IMPORTANT: The slide MUST clearly display the following text in Russian Cyrillic: "${scene.text.slice(0, 50)}..."
            Render the text legibly as the slide title or main element.`)
            .then(img => ({ image: img }))
            .catch(e => {
              console.error("Image Gen Error", e);
              return { image: null };
            });
          mediaPromises.push(imagePromise);

          // 2. Audio Generation
          const audioPromise = generateSpeech(scene.text)
            .then(buffer => {
               // Convert ArrayBuffer to base64 string for data URI
               const binary = Buffer.from(buffer).toString('base64');
               return { audio: `data:audio/wav;base64,${binary}` };
            })
            .catch(e => {
              console.error("Audio Gen Error", e);
              return { audio: null };
            });
          mediaPromises.push(audioPromise);

          const results = await Promise.all(mediaPromises);
          return results.reduce((acc, curr) => ({ ...acc, ...curr }), { ...scene });
        })
      );

      return NextResponse.json({
        video: {
          title: scriptData.title || "Видеопересказ",
          scenes: scenesWithMedia,
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