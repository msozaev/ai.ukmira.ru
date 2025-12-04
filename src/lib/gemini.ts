import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GOOGLE_API_KEY) {
  // Keep it silent in production; runtime check happens per call.
  console.warn("GOOGLE_API_KEY не задан. Установите переменную окружения.");
}

const BASE_SYSTEM_PROMPT = `Ты — Miraverse, русскоязычный тьютор и исследователь. 
- Отвечай лаконично, но содержательно. 
- Всегда опирайся только на предоставленные источники, цитируй их смыслами, а не ссылками.
- Стиль: дружелюбный, уверенный, без излишней формальности.
- Показывай структурированные списки и подзаголовки, где это повышает читаемость.`;

export type Source = {
  id: string;
  title: string;
  type: "file" | "link" | "youtube" | "text";
  content: string;
  url?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StudioMode =
  | "chat"
  | "audio"
  | "video"
  | "mindmap"
  | "report"
  | "flashcards"
  | "quiz"
  | "infographic"
  | "slides";

const modeGuides: Record<StudioMode, string> = {
  chat: "Кратко ответь на вопрос, если нужно предложи дальнейшие шаги обучения.",
  audio:
    "Role: You are an expert podcast producer and scriptwriter. Task: Create a 'Deep Dive' audio script strictly based on source documents. Characters: Host A (Guide, knowledgeable) and Host B (Color, curious). Guidelines: 1. LANGUAGE: STRICTLY RUSSIAN (Русский). 2. LENGTH: CRITICAL. Generate a 10-MINUTE SCRIPT (approx 2000 words). Do not summarize; go deep. 3. Style: Natural conversation, contractions, interjections. 4. Structure: Hook -> Deep Dive Body (explore nuances, give examples, debate points) -> Conclusion. IMPORTANT: RETURN ONLY JSON. Format: {\"title\":\"Podcast Title\",\"dialogue\":[{\"speaker\":\"Host A\",\"text\":\"...\"},{\"speaker\":\"Host B\",\"text\":\"...\"}]}. Generate at least 60-80 detailed exchanges.",
  video:
    "Role: You are an expert Instructional Designer and Virtual Lecturer. Task: Create a script for a 'Video Learning Guide' (slides + voiceover). Audience: Students/professionals. Guidelines: 1. Structure: Title -> Agenda -> Body (1 concept/slide) -> Summary. 2. Visual Instructions: Explicitly design the slide. Format: 'HEADER: [Text] | BULLETS: [3-4 points] | GRAPHIC: [Chart/Diagram description]'. Keep text minimal. 3. Audio: Clear, professional. Do NOT just read bullets; explain context. Fidelity: Only use source concepts. IMPORTANT: RETURN ONLY JSON. Format: {\"title\":\"...\",\"scenes\":[{\"headline\":\"Slide Title (Russian, concise, max 7 words)\",\"text\":\"Narration text (Russian)...\",\"visual\":\"Slide description (Russian) using HEADER | BULLETS | GRAPHIC format...\"}]}. Generate 8-12 scenes.",
  mindmap:
    "Верни ментальную карту в виде вложенного списка: главные узлы, подузлы, примеры. Не более 3 уровней вложенности.",
  report:
    "Сформируй аналитический отчёт: цель, ключевые выводы, аргументы, риски/ограничения, рекомендации, список действий.",
  flashcards:
    "Сделай 8–12 двусторонних карточек в формате 'Вопрос — Ответ'. Коротко, по одному факту, без лишнего текста.",
  quiz:
    "Сделай мини-тест из 8–10 вопросов смешанных типов (множественный выбор + открытый). Добавь правильные ответы после списка.",
  infographic:
    "Верни ТОЛЬКО JSON без пояснений. Формат: {\"title\":\"...\",\"blocks\":[{\"title\":\"...\",\"content\":\"...\"}],\"takeaway\":\"...\"}. 3-5 блоков. Без markdown, без текста вне JSON.",
  slides:
    "Верни ТОЛЬКО JSON без пояснений. Формат: {\"title\":\"...\",\"slides\":[{\"title\":\"...\",\"bullets\":[\"...\"]}]}. 8-12 слайдов, 3-5 bullets каждый. Без markdown, без текста вне JSON.",
};

function trimSources(sources: Source[], limit = 18000) {
  const chunks: string[] = [];
  let total = 0;
  for (const src of sources) {
    const header = `# ${src.title} (${src.type}${src.url ? `: ${src.url}` : ""})`;
    const remaining = Math.max(0, limit - total - header.length);
    if (remaining <= 0) break;
    const text = src.content.slice(0, remaining);
    const block = `${header}\n${text}`;
    total += block.length;
    chunks.push(block);
  }
  return chunks.join("\n\n");
}

export async function runGemini(options: {
  mode: StudioMode;
  prompt: string;
  sources: Source[];
  history?: ChatMessage[];
}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY не задан");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3-pro-preview",
    systemInstruction: BASE_SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.35,
      topP: 0.95,
      topK: 32,
      maxOutputTokens: 8192,
    },
  });

  const context = trimSources(options.sources);
  const historyText = (options.history || [])
    .map((m) => `${m.role === "user" ? "Пользователь" : "ИИ"}: ${m.content}`)
    .join("\n");

  const fullPrompt = `Режим: ${options.mode}.\n${modeGuides[options.mode]}\n\nИсточники:\n${context || "(источники не заданы)"}\n\nХод диалога:\n${historyText}\n\nЗапрос пользователя:\n${options.prompt}`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
  });

  const text = result.response.text();
  return text;
}

export async function generateImage(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY не задан");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3-pro-image-preview" });

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Generate an image: " + prompt }] }],
    });

    const response = result.response;
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("No candidates returned");
    }

    // Check for inline data (image)
    const part = response.candidates[0].content.parts[0];
    if (!part || !part.inlineData || !part.inlineData.data) {
       // Fallback check if it returned text refusing to generate
       const text = response.text();
       if (text) throw new Error(`Model returned text instead of image: ${text}`);
       throw new Error("No image data in response");
    }

    return part.inlineData.data;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Gemini Image Gen Error:", e);
    throw new Error(`Gemini Image Gen Failed: ${message}`);
  }
}

export function createWavHeader(dataLength: number, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export async function generateMultiSpeakerSpeech(dialogue: { speaker: string; text: string }[]): Promise<ArrayBuffer> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY не задан");

  const model = "gemini-2.5-pro-preview-tts";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // 1. Construct the script string
  const scriptText = dialogue.map(line => `${line.speaker}: ${line.text}`).join("\n");

  // 2. Construct the request payload
  const payload = {
    contents: [{ parts: [{ text: scriptText }] }],
    generationConfig: {
      response_modalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: "Host A",
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } }
            },
            {
              speaker: "Host B",
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
            }
          ]
        }
      }
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini TTS API Error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("No candidates returned");
    }

    const part = data.candidates[0].content.parts[0];
    if (!part || !part.inlineData || !part.inlineData.data) {
        throw new Error("No audio data in response");
    }

    // Convert base64 to Uint8Array (Raw PCM)
    const binaryString = atob(part.inlineData.data);
    const len = binaryString.length;
    const pcmBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
    }

    // Add WAV Header
    const header = createWavHeader(len);
    const wavBuffer = new Uint8Array(header.byteLength + len);
    wavBuffer.set(new Uint8Array(header), 0);
    wavBuffer.set(pcmBytes, header.byteLength);

    return wavBuffer.buffer;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Gemini Multi-Speaker TTS Error:", e);
    throw new Error(`Gemini Multi-Speaker TTS Failed: ${message}`);
  }
}

export async function generateSpeech(text: string, voiceName: string = "Charon"): Promise<ArrayBuffer> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY не задан");

  // Correct model ID from documentation
  const model = "gemini-2.5-pro-preview-tts";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Read this text naturally in Russian: " + text }] }],
        generationConfig: {
          response_modalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName
              }
            }
          }
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini TTS API Error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("No candidates returned");
    }

    const part = data.candidates[0].content.parts[0];
    if (!part || !part.inlineData || !part.inlineData.data) {
        throw new Error("No audio data in response");
    }

    // Convert base64 to Uint8Array (Raw PCM)
    const binaryString = atob(part.inlineData.data);
    const len = binaryString.length;
    const pcmBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        pcmBytes[i] = binaryString.charCodeAt(i);
    }

    // Add WAV Header
    const header = createWavHeader(len);
    const wavBuffer = new Uint8Array(header.byteLength + len);
    wavBuffer.set(new Uint8Array(header), 0);
    wavBuffer.set(pcmBytes, header.byteLength);

    return wavBuffer.buffer;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Gemini Speech Gen Error:", e);
    throw new Error(`Gemini Speech Gen Failed: ${message}`);
  }
}
