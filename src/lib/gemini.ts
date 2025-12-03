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
    "Сделай сценарий аудиопересказа на 3–5 минут. Добавь цепляющий зачин, 3–4 смысловых блока, плавные переходы и финальный вывод.",
  video:
    "Верни ТОЛЬКО JSON без пояснений. Формат: {\"title\":\"...\",\"scenes\":[{\"text\":\"Текст озвучки (нарратив)...\",\"visual\":\"Подробное описание картинки для генерации (на английском)...\"}]}. Сделай 5-7 сцен. Текст должен быть готовым для чтения вслух. Visual должен быть детальным prompt для DALL-E/Midjourney.",
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "3:4",
        outputOptions: { mimeType: "image/jpeg" }
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Imagen API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const base64Image = data.predictions?.[0]?.bytesBase64Encoded;

  if (!base64Image) {
    throw new Error("No image generated");
  }

  return base64Image;
}
