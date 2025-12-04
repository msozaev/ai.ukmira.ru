import { NextRequest, NextResponse } from "next/server";
import { runGemini, generateImage, generateSpeech, generateMultiSpeakerSpeech, createWavHeader, type Source, type StudioMode, type ChatMessage } from "@/lib/gemini";

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

    if (body.mode === "audio") {
        const scriptRaw = await runGemini({
            mode: body.mode,
            prompt: body.prompt,
            sources: body.sources || [],
            history: body.history || [],
        });

        const cleanedJson = scriptRaw.replace(/```json|```/gi, "").trim();
        let scriptData;
        try {
            scriptData = JSON.parse(cleanedJson);
        } catch (e) {
            console.error("JSON Parse Error", e);
            return NextResponse.json({ text: scriptRaw });
        }

        const dialogue = scriptData.dialogue || [];
        const CHUNK_SIZE = 30; // ~30 lines of dialogue per TTS request (approx 4-5 mins audio)
        const allPcmChunks: Uint8Array[] = [];
        let totalCombinedPcmLength = 0;

        for (let i = 0; i < dialogue.length; i += CHUNK_SIZE) {
            const chunk = dialogue.slice(i, i + CHUNK_SIZE);
            try {
                // Generate audio for this chunk
                const audioBuffer = await generateMultiSpeakerSpeech(chunk);

                if (audioBuffer && audioBuffer.byteLength > 44) {
                    const pcmData = new Uint8Array(audioBuffer).slice(44); // Strip WAV header
                    allPcmChunks.push(pcmData);
                    totalCombinedPcmLength += pcmData.length;
                }
            } catch (e) {
                console.error("Audio Gen Error for chunk:", e);
                // Continue processing other chunks even if one fails, or decide to fail fast.
                // For now, let's just log and continue.
            }
        }
        
        // Stitch all PCM chunks together into one
        const finalCombinedPcm = new Uint8Array(totalCombinedPcmLength);
        let offset = 0;
        for (const pcmChunk of allPcmChunks) {
            finalCombinedPcm.set(pcmChunk, offset);
            offset += pcmChunk.length;
        }

        // Create new WAV Header for the full length
        const header = createWavHeader(totalCombinedPcmLength);
        const finalWavFile = new Uint8Array(header.byteLength + totalCombinedPcmLength);
        finalWavFile.set(new Uint8Array(header), 0);
        finalWavFile.set(finalCombinedPcm, header.byteLength);

        const binary = Buffer.from(finalWavFile).toString('base64');
        const audioUrl = `data:audio/wav;base64,${binary}`;

        return NextResponse.json({
            audioProject: {
                title: scriptData.title || "Подкаст",
                audioUrl: audioUrl
            },
            text: "Подкаст готов."
        });
    }

    if (body.mode === "slides") {
        const resultRaw = await runGemini({
            mode: body.mode,
            prompt: body.prompt,
            sources: body.sources || [],
            history: body.history || [],
        });

        const cleanedJson = resultRaw.replace(/```json|```/gi, "").trim();
        let slidesData;
        try {
            slidesData = JSON.parse(cleanedJson);
        } catch (e) {
            console.error("JSON Parse Error", e);
            return NextResponse.json({ text: resultRaw });
        }

        if (!slidesData?.slides || !Array.isArray(slidesData.slides)) {
            return NextResponse.json({ text: resultRaw });
        }

        // Generate visuals for each slide in parallel
        const slidesWithVisuals = await Promise.all(
            slidesData.slides.map(async (slide: { title: string; bullets: string[] }) => {
                try {
                    // Create a rich visual prompt for the slide
                    const visualPrompt = `Create a professional presentation slide.
                    Title: "${slide.title}"
                    Key concepts: ${slide.bullets.slice(0, 3).join(", ")}.
                    Style: Modern, corporate, clean, white background, high legibility, infographic style elements.
                    IMPORTANT: The slide should visually represent these concepts. If text is rendered, it must be the title in Russian Cyrillic.`;
                    
                    const img = await generateImage(visualPrompt);
                    return { ...slide, image: img };
                } catch (e) {
                    console.error("Slide Image Gen Error", e);
                    return { ...slide, image: null };
                }
            })
        );

        return NextResponse.json({
            slides: {
                title: slidesData.title || "Презентация",
                slides: slidesWithVisuals
            },
            text: "Презентация готова."
        });
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
        scriptData.scenes.map(async (scene: { text: string; visual: string; headline?: string }) => {
          type MediaResult = { image?: string | null; audio?: string | null };
          const mediaPromises: Promise<MediaResult>[] = [];
          
          // 1. Image Generation
          const slideText = scene.headline || scene.text.slice(0, 50);
          const imagePromise = generateImage(`Create a presentation slide. 
            Visual style: Modern, minimalist, educational, clean vector graphics, white background.
            Content: ${scene.visual}
            IMPORTANT: The slide MUST clearly display the following text in Russian Cyrillic: "${slideText}"
            Render the text legibly as the slide title.`)
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
