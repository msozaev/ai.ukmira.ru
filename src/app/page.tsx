"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { v4 as uuid } from "uuid";
import type { ChatMessage, Source, StudioMode } from "@/lib/gemini";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

type StudioCard = {
  key: StudioMode;
  title: string;
  desc: string;
  gradient: string;
};

type ParsedQuiz = { quiz?: QuizQuestion[]; message: string };

type InfographicSpec = { title: string; blocks: { title: string; content: string }[]; takeaway?: string };
type SlidesSpec = { title: string; slides: { title: string; bullets: string[] }[] };
type VideoSpec = { title: string; scenes: { text: string; visual: string; image?: string | null; audio?: string | null }[] };
type AudioSpec = { title: string; audioUrl: string };

function extractQuiz(raw: string): ParsedQuiz {
  const codeBlockMatch = raw.match(/```json([\s\S]*?)```/i);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1] : (() => {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return raw.slice(start, end + 1);
    return raw;
  })();

  const parseQuestionsArray = (parsed: unknown) => {
    const obj = parsed as { questions?: unknown };
    if (Array.isArray(obj.questions)) {
      const quiz = obj.questions
        .filter(
          (q: { question: unknown; options: unknown[] }) =>
            typeof q?.question === "string" &&
            Array.isArray(q?.options) &&
            q.options.length === 4 &&
            q.options.every((o) => typeof o === "string")
        )
        .map((q: { question: string; options: string[]; answer?: number }) => ({
          question: q.question,
          options: q.options,
          answer: Number(q.answer ?? 0),
        }));
      if (quiz.length) return quiz;
    }
    return undefined;
  };

  const cleanJson = (text: string) =>
    text
      .replace(/```json|```/gi, "")
      .replace(/\r?\n/g, " ")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();

  const tryParsers = [jsonCandidate, cleanJson(jsonCandidate)];

  const questionsMatch = raw.match(/"questions"\s*:\s*(\[[\s\S]*?\])/);
  if (questionsMatch) {
    tryParsers.push(`{"questions":${questionsMatch[1]}}`);
    tryParsers.push(cleanJson(`{"questions":${questionsMatch[1]}}`));
  }

  for (const candidate of tryParsers) {
    try {
      const parsed = JSON.parse(candidate);
      const quiz = parseQuestionsArray(parsed);
      if (quiz) return { quiz, message: "Тест готов. Нажмите, чтобы пройти." };
    } catch { }
  }

  // Fallback: parse markdown-like MCQ
  const cleanedLines = raw
    .replace(/\*\*/g, "")
    .replace(/^#+/gm, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const quiz: QuizQuestion[] = [];
  let current: QuizQuestion | null = null;

  const optionRegex = /^[-*]?\s*[A-DА-Га-г][).\]]\s*(.+)$/i;
  const questionRegex = /^\d+[).]\s+(.+)/;

  for (const line of cleanedLines) {
    const qMatch = line.match(questionRegex);
    if (qMatch) {
      if (current && current.options.length === 4) quiz.push(current);
      current = { question: qMatch[1].trim(), options: [], answer: 0 };
      continue;
    }
    if (current) {
      const oMatch = line.match(optionRegex);
      if (oMatch && current.options.length < 4) {
        const text = oMatch[1].trim();
        current.options.push(text);
        const isCorrect = /верн|правил|correct|✔|✅/i.test(text);
        if (isCorrect) current.answer = current.options.length - 1;
      }
    }
  }
  if (current && current.options.length === 4) quiz.push(current);

  if (quiz.length) return { quiz, message: "Тест готов. Нажмите, чтобы пройти." };

  return { message: raw };
}

function parseInfographic(raw: string): InfographicSpec | null {
  try {
    const cleaned = raw.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed?.title && Array.isArray(parsed?.blocks)) {
      const blocks = parsed.blocks
        .filter((b: { title: unknown; content: unknown }) => typeof b?.title === "string" && typeof b?.content === "string")
        .map((b: { title: string; content: string }) => ({ title: b.title, content: b.content }));
      if (blocks.length) {
        return { title: String(parsed.title), blocks, takeaway: typeof parsed.takeaway === "string" ? parsed.takeaway : undefined };
      }
    }
  } catch { }
  return null;
}

function parseSlides(raw: string): SlidesSpec | null {
  try {
    const cleaned = raw.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed?.title && Array.isArray(parsed?.slides)) {
      const slides = parsed.slides
        .filter((s: { title: unknown; bullets: unknown[] }) => typeof s?.title === "string" && Array.isArray(s?.bullets))
        .map((s: { title: string; bullets: unknown[] }) => ({
          title: s.title,
          bullets: s.bullets.filter((b) => typeof b === "string") as string[],
        }))
        .filter((s: { bullets: string[] }) => s.bullets.length);
      if (slides.length) return { title: String(parsed.title), slides };
    }
  } catch { }
  return null;
}

type QuizQuestion = {
  question: string;
  options: string[];
  answer: number;
  userAnswer?: number;
};

type StudioResult = {
  id: string;
  mode: StudioMode;
  title: string;
  status: "loading" | "ready" | "error";
  content: string;
  quiz?: QuizQuestion[];
  infographic?: InfographicSpec;
  slides?: SlidesSpec;
  video?: VideoSpec;
  audioProject?: AudioSpec;
  image?: string;
};

const studioCards: StudioCard[] = [
  { key: "audio", title: "Аудиопересказ", desc: "", gradient: "from-sky-400/50 to-cyan-500/30" },
  { key: "video", title: "Видеопересказ", desc: "", gradient: "from-emerald-400/50 to-teal-500/30" },
  { key: "mindmap", title: "Ментальная карта", desc: "", gradient: "from-violet-400/50 to-indigo-500/30" },
  { key: "report", title: "Отчеты", desc: "", gradient: "from-amber-400/50 to-orange-500/30" },
  { key: "flashcards", title: "Карточки", desc: "", gradient: "from-pink-400/50 to-rose-500/30" },
  { key: "quiz", title: "Тест", desc: "", gradient: "from-blue-400/50 to-indigo-400/30" },
  { key: "infographic", title: "Инфографика", desc: "", gradient: "from-lime-400/50 to-emerald-400/30" },
  { key: "slides", title: "Презентация", desc: "", gradient: "from-fuchsia-400/50 to-purple-500/30" },
];

type Tab = "file" | "link" | "youtube" | "text" | null;

const cx = (...classes: (string | boolean | undefined | null)[]) =>
  classes.filter(Boolean).join(" ");

export default function Home() {
  const [sources, setSources] = useState<Source[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [ytUrl, setYtUrl] = useState("");
  const [textSource, setTextSource] = useState("");
  const [textTitle, setTextTitle] = useState("Свободный текст");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Привет! Я Miraverse — ваш личный ИИ репетитор. Добавь источники слева и задай вопрос, или запусти любой инструмент студии справа.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isChatLoading, setChatLoading] = useState(false);
  const [studioLoading, setStudioLoading] = useState<StudioMode | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState<string>("");
  const [modalContent, setModalContent] = useState<string>("");
  const [modalQuiz, setModalQuiz] = useState<QuizQuestion[] | null>(null);
  const [modalInfographic, setModalInfographic] = useState<InfographicSpec | null>(null);
  const [modalSlides, setModalSlides] = useState<SlidesSpec | null>(null);
  const [modalVideo, setModalVideo] = useState<VideoSpec | null>(null);
  const [modalAudio, setModalAudio] = useState<AudioSpec | null>(null);
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [studioResults, setStudioResults] = useState<StudioResult[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableSources = useMemo(
    () => sources.filter((s) => selectedSources.length === 0 || selectedSources.includes(s.id)),
    [sources, selectedSources]
  );

  const toggleSource = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data?.sources) {
      setSources((prev) => [...prev, ...data.sources]);
      setSelectedSources((prev) => [...prev, ...data.sources.map((s: Source) => s.id)]);
    }
  };

  const handleLinkFetch = async () => {
    if (!linkUrl) return;
    const res = await fetch("/api/link", {
      method: "POST",
      body: JSON.stringify({ url: linkUrl }),
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data?.source) {
      setSources((prev) => [...prev, data.source]);
      setSelectedSources((prev) => [...prev, data.source.id]);
      setLinkUrl("");
      setActiveTab(null);
    }
  };

  const handleYoutubeFetch = async () => {
    if (!ytUrl) return;
    const res = await fetch("/api/youtube", {
      method: "POST",
      body: JSON.stringify({ url: ytUrl }),
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data?.source) {
      setSources((prev) => [...prev, data.source]);
      setSelectedSources((prev) => [...prev, data.source.id]);
      setYtUrl("");
      setActiveTab(null);
    }
  };

  const handleTextAdd = () => {
    if (!textSource.trim()) return;
    const source: Source = {
      id: uuid(),
      title: textTitle || "Текст",
      type: "text",
      content: textSource,
    };
    setSources((prev) => [...prev, source]);
    setSelectedSources((prev) => [...prev, source.id]);
    setTextSource("");
    setTextTitle("Свободный текст");
    setActiveTab(null);
  };

  const sendMessage = async (value?: string) => {
    const prompt = (value ?? input).trim();
    if (!prompt) return;
    const userMsg: ChatMessage = { role: "user", content: prompt };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          prompt,
          sources: availableSources,
          history: [...messages, userMsg],
        }),
      });
      const data = await res.json();
      const reply: ChatMessage = { role: "assistant", content: data.text || data.error || "Не удалось сгенерировать ответ" };
      setMessages((prev) => [...prev, reply]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "неизвестно";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Ошибка: ${message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const runStudio = async (mode: StudioMode) => {
    setStudioLoading(mode);
    const id = uuid();
    const newItem: StudioResult = {
      id,
      mode,
      title: studioCards.find((c) => c.key === mode)?.title || mode,
      status: "loading",
      content: "",
    };
    setStudioResults((prev) => [newItem, ...prev]);
    const systemPrompts: Record<StudioMode, string> = {
      chat: "",
      audio: "Создай аудиопересказ 3–5 минут по источникам.",
      video: "Сделай видеосценарий с подсказками визуала.",
      mindmap: "Построй ментальную карту: 2–3 уровня вложенности.",
      report: "Сформируй аналитический отчёт с выводами и рекомендациями.",
      flashcards: "Сделай 10 карточек Вопрос/Ответ.",
      quiz:
        "Верни ТОЛЬКО JSON без пояснений и текста. Формат: {\"questions\":[{\"question\":\"...\",\"options\":[\"вариант1\",\"вариант2\",\"вариант3\",\"вариант4\"],\"answer\":0}]}. 5-10 вопросов, options ровно 4, answer — индекс правильного (0-3). Без маркдауна, без троеточий, без текста вокруг.",
      infographic: "Опиши структуру инфографики и данные для неё.",
      slides: "Составь план презентации на 10 слайдов с заметками спикера.",
    };

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt: systemPrompts[mode],
          sources: availableSources,
          history: messages,
        }),
      });
      const data = await res.json();
      let content = data.text ?? data.error ?? "Нет ответа";
      let quizPayload: QuizQuestion[] | undefined = undefined;
      let infographicPayload: InfographicSpec | undefined = undefined;
      let slidesPayload: SlidesSpec | undefined = undefined;
      const videoPayload: VideoSpec | undefined = data.video;
      const audioPayload: AudioSpec | undefined = data.audioProject;
      const imagePayload: string | undefined = data.image;

      if (mode === "quiz") {
        const parsed = extractQuiz(content);
        content = parsed.message;
        quizPayload = parsed.quiz;
        if (quizPayload && quizPayload.length === 0) quizPayload = undefined;
        if (quizPayload) content = "Тест готов. Нажмите, чтобы пройти.";
        if (!quizPayload && parsed.message === content && content === "Нет ответа") {
          content = "Не удалось разобрать тест. Попробуйте снова.";
        }
      } else if (mode === "infographic") {
        if (imagePayload) {
          content = "Инфографика готова. Нажмите, чтобы посмотреть.";
        } else {
          const parsed = parseInfographic(content);
          if (parsed) {
            infographicPayload = parsed;
            content = "Инфографика готова. Нажмите, чтобы посмотреть.";
          }
        }
      } else if (mode === "slides") {
        const parsed = parseSlides(content);
        if (parsed) {
          slidesPayload = parsed;
          content = "Презентация готова. Нажмите, чтобы посмотреть.";
        }
      } else if (mode === "video" && videoPayload) {
        content = "Видео готово. Нажмите, чтобы посмотреть.";
      } else if (mode === "audio" && audioPayload) {
        content = "Аудиопересказ готов. Нажмите, чтобы слушать.";
      }
      setStudioResults((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "ready",
                content,
                quiz: quizPayload,
                infographic: infographicPayload,
                slides: slidesPayload,
                video: videoPayload,
                audioProject: audioPayload,
                image: imagePayload,
              }
            : item
        )
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "неизвестно";
      setStudioResults((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "error", content: `Ошибка: ${message}` } : item
        )
      );
    } finally {
      setStudioLoading(null);
    }
  };

  const suggested = [
    "Сделай краткий конспект ключевых идей",
    "Предложи 5 вопросов для самопроверки",
    "Какие практические шаги можно сделать за неделю?",
    "Объясни это простыми словами",
  ];

  return (
    <div className="min-h-screen flex flex-col px-3 pt-4 pb-4 sm:px-4 lg:px-6 xl:px-10">
      <div className="mx-auto flex w-full flex-1 flex-col gap-5 lg:gap-6">
        <header className="flex items-center justify-between rounded-2xl glass px-4 py-2 shadow-lg">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="MIRAVERSE" className="h-16 w-auto brightness-300 saturate-300" />
            <div>
              <p className="text-sm text-slate-300">M I R A V E R S E </p>
              <h1 className="text-lg font-semibold text-white">ИИ Репетитор</h1>
            </div>
          </div>
          <div className="hidden items-center gap-3 text-sm text-slate-300 md:flex">

          </div>
        </header>

        <div className="layout-grid pb-4 flex-1 min-h-[75vh]">
          {/* Sidebar */}
          <aside className="glass-strong dot-grid rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Источники</p>
                <h2 className="text-lg font-semibold text-white">Рабочая коллекция</h2>
              </div>
              {/* <button
                onClick={() => setSelectedSources(sources.map((s) => s.id))}
                className="text-xs text-cyan-200 hover:text-cyan-100"
              >
                Выбрать все
              </button> */}
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white hover:-translate-y-[1px]"
                >
                  📂 Файл
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === "link" ? null : "link")}
                  className={cx("glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white hover:-translate-y-[1px]", activeTab === "link" && "border-cyan-300/50 text-cyan-100")}
                >
                  🔗 Ссылка
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === "youtube" ? null : "youtube")}
                  className={cx("glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white hover:-translate-y-[1px]", activeTab === "youtube" && "border-cyan-300/50 text-cyan-100")}
                >
                  ▶️ YouTube
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === "text" ? null : "text")}
                  className={cx("glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white hover:-translate-y-[1px]", activeTab === "text" && "border-cyan-300/50 text-cyan-100")}
                >
                  📝 Текст
                </button>
              </div>

              {/* Dynamic forms */}
              {activeTab === "link" && (
                <div className="glass rounded-xl p-3 space-y-2">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none border border-white/10 focus:border-cyan-400/60"
                  />
                  <button onClick={handleLinkFetch} className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400">Добавить ссылку</button>
                </div>
              )}
              {activeTab === "youtube" && (
                <div className="glass rounded-xl p-3 space-y-2">
                  <input
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="https://youtube.com/..."
                    className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none border border-white/10 focus:border-cyan-400/60"
                  />
                  <button onClick={handleYoutubeFetch} className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400">Импортировать</button>
                </div>
              )}
              {activeTab === "text" && (
                <div className="glass rounded-xl p-3 space-y-2">
                  <input
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    placeholder="Название"
                    className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none border border-white/10 focus:border-cyan-400/60"
                  />
                  <textarea
                    value={textSource}
                    onChange={(e) => setTextSource(e.target.value)}
                    rows={4}
                    placeholder="Вставьте текст или заметки"
                    className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none border border-white/10 focus:border-cyan-400/60"
                  />
                  <button onClick={handleTextAdd} className="w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-cyan-400">Добавить текст</button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />

              <div className="mt-3 space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {sources.length === 0 && (
                  <p className="text-sm text-slate-400">Добавьте PDF, ссылки, видео или текст, чтобы генерировать материалы.</p>
                )}
                {sources.map((src) => (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id)}
                  className={cx(
                    "w-full rounded-xl px-3 py-2 text-left glass border border-transparent transition hover:-translate-y-[1px]",
                    selectedSources.includes(src.id) && "border-cyan-300/50 shadow-[0_0_0_1px_rgba(103,232,249,0.2)]"
                  )}
                >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 text-lg">{src.type === "file" ? "📄" : src.type === "link" ? "🌐" : src.type === "youtube" ? "🎬" : "📝"}</div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white line-clamp-1">{src.title}</p>
                        <p className="text-xs text-slate-400 line-clamp-2">{src.content.slice(0, 120)}...</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Chat */}
          <section className="glass-strong rounded-2xl p-4 flex flex-col h-full self-stretch">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Чат</p>
                <h2 className="text-xl font-semibold text-white">Диалог с тьютором</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Miraverse AI подключен
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1">
              {messages.map((m, idx) => (
                <div key={idx} className={cx("rounded-2xl px-3 py-2 max-w-3xl", m.role === "assistant" ? "bg-white/5" : "bg-cyan-500/20 border border-cyan-300/30 ml-auto")}>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400 mb-1">{m.role === "assistant" ? "Miraverse" : "Вы"}</p>
                  <div
                    className="text-sm leading-relaxed text-slate-100 space-y-2"
                    dangerouslySetInnerHTML={{ __html: marked.parse(m.content || "") }}
                  />
                </div>
              ))}
              {isChatLoading && <div className="text-sm text-slate-400">Генерация ответа...</div>}
            </div>

            <div className="glass mt-2 rounded-2xl border border-white/10 p-3">
              <div className="flex flex-wrap gap-2 pb-2">
                {suggested.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 border border-white/10 hover:border-cyan-300/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Спросите тьютора..."
                  className="flex-1 rounded-xl bg-white/5 px-3 py-3 text-sm text-white outline-none border border-white/10 focus:border-cyan-400/60"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={isChatLoading}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-500 px-4 py-3 text-sm font-semibold text-slate-900 shadow-lg hover:shadow-cyan-400/30 disabled:opacity-60"
                >
                  Отправить
                </button>
              </div>
            </div>
          </section>

          {/* Studio */}
          <aside className="glass-strong rounded-2xl p-4 space-y-3 h-full self-stretch">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Студия</p>
                <h2 className="text-xl font-semibold text-white">Автогенерация</h2>
              </div>
              <span className="text-xs text-slate-400">Выбрано: {availableSources.length}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {studioCards.map((card) => (
                <button
                  key={card.key}
                  onClick={() => runStudio(card.key)}
                  className="relative overflow-hidden rounded-lg border border-white/10 px-3 py-2 text-left glass hover:-translate-y-[1px]"
                >
                  <div className={cx("absolute inset-0 blur-2xl opacity-70", `bg-gradient-to-br ${card.gradient}`)} />
                  <div className="relative">
                    <p className="text-sm font-semibold text-white">{card.title}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="glass mt-2 rounded-2xl border border-white/10 p-3 min-h-[140px] space-y-2">
              {/* <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Результаты</p> */}
              {studioResults.length === 0 && (
                <p className="text-sm text-slate-400">Нажмите на карточку, чтобы сгенерировать результат.</p>
              )}
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {studioResults.map((item) => (
                  <button
                    key={item.id}
                    disabled={item.status === "loading"}
                    onClick={() => {
                      if (item.status !== "ready" && item.status !== "error") return;
                      let parsedQuiz = item.quiz;
                      let parsedContent = item.content;
                      let parsedInfographic = item.infographic;
                      let parsedSlides = item.slides;
                      const parsedVideo = item.video;
                      const parsedAudio = item.audioProject;

                      if (!parsedQuiz) {
                        const parsed = extractQuiz(item.content);
                        if (parsed.quiz?.length) parsedQuiz = parsed.quiz;
                        if (parsed.message) parsedContent = parsed.message;
                      }

                      if (!parsedInfographic && item.mode === "infographic") {
                        parsedInfographic = parseInfographic(item.content) ?? undefined;
                        if (parsedInfographic) parsedContent = "Инфографика готова. Нажмите, чтобы посмотреть.";
                      }

                      if (!parsedSlides && item.mode === "slides") {
                        parsedSlides = parseSlides(item.content) ?? undefined;
                        if (parsedSlides) parsedContent = "Презентация готова. Нажмите, чтобы посмотреть.";
                      }

                      setModalTitle(item.title);
                      setModalContent(parsedContent);
                      setModalQuiz(parsedQuiz ? parsedQuiz.map((q) => ({ ...q })) : null);
                      setModalInfographic(parsedInfographic ?? null);
                      setModalSlides(parsedSlides ?? null);
                      setModalVideo(parsedVideo ?? null);
                      setModalAudio(parsedAudio ?? null);
                      setModalImage(item.image ?? null);
                      setModalOpen(true);
                    }}
                    className={cx(
                      "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:-translate-y-[1px]",
                      item.status === "loading" && "opacity-70",
                      "hover:border-cyan-300/50"
                    )}
                  >
                    <div className="flex items-center justify-between text-sm text-white">
                      <span>{item.title}</span>
                      <span className="text-xs text-slate-400">
                        {item.status === "loading" ? "Готовим материал..." : item.status === "error" ? "Ошибка" : "Готово"}
                      </span>
                    </div>
                    {item.status === "ready" && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-300">
                        {item.quiz ? `${item.quiz.length} вопросов` : item.content}
                      </p>
                    )}
                    {item.status === "error" && (
                      <p className="mt-1 text-xs text-rose-300">{item.content}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-3xl rounded-2xl bg-slate-900/90 border border-white/10 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">{modalTitle || "Результат"}</p>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-3 text-[15px] leading-relaxed">
              {studioLoading ? (
                <p className="text-base text-slate-200">Генерация...</p>
              ) : modalQuiz ? (
                <QuizView quiz={modalQuiz} setQuiz={setModalQuiz} />
              ) : modalInfographic ? (
                <InfographicView data={modalInfographic} />
              ) : modalSlides ? (
                <SlidesView data={modalSlides} />
              ) : modalVideo ? (
                <VideoView data={modalVideo} />
              ) : modalAudio ? (
                <AudioPlayerView data={modalAudio} />
              ) : modalImage ? (
                <div className="flex justify-center">
                  <img src={`data:image/jpeg;base64,${modalImage}`} alt="Infographic" className="rounded-xl max-w-full h-auto" />
                </div>
              ) : (
                <div
                  className="text-base leading-relaxed text-slate-100 space-y-3"
                  dangerouslySetInnerHTML={{ __html: marked.parse(modalContent || "") }}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:border-cyan-300/60"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuizView({
  quiz,
  setQuiz,
}: {
  quiz: QuizQuestion[];
  setQuiz: (q: QuizQuestion[] | null) => void;
}) {
  const [step, setStep] = useState(0);
  const answered = quiz.filter((q) => q.userAnswer !== undefined).length;
  const total = quiz.length;
  const correct = quiz.filter((q) => q.userAnswer === q.answer).length;
  const percent = total ? Math.round((correct / total) * 100) : 0;

  const currentIndex = Math.min(step, Math.max(0, total - 1));
  const current = quiz[currentIndex];
  if (!current) {
    return <p className="text-sm text-slate-200">Нет вопросов. Попробуйте сгенерировать снова.</p>;
  }

  const select = (idx: number, option: number) => {
    setQuiz(
      quiz.map((q, i) =>
        i === idx && q.userAnswer === undefined
          ? { ...q, userAnswer: option }
          : q
      )
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <span>Вопрос {currentIndex + 1} из {total}</span>
        <span>Отвечено: {answered}/{total}</span>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-base font-semibold text-white mb-3">{currentIndex + 1}. {current.question}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {current.options.map((opt, oi) => {
            const selected = current.userAnswer === oi;
            const isCorrect = current.userAnswer !== undefined && current.answer === oi;
            return (
              <button
                key={oi}
                onClick={() => select(currentIndex, oi)}
                disabled={current.userAnswer !== undefined}
                className={cx(
                  "w-full rounded-lg border px-3 py-3 text-left text-base transition",
                  selected ? "border-cyan-400/80 bg-cyan-400/10 text-white" : "border-white/15 bg-white/5 text-slate-200",
                  current.userAnswer !== undefined && isCorrect && "border-emerald-400 bg-emerald-400/10",
                  current.userAnswer !== undefined && selected && !isCorrect && "border-rose-400 bg-rose-400/10"
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setStep(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
        >
          Назад
        </button>
        <button
          onClick={() => setStep(Math.min(total - 1, currentIndex + 1))}
          disabled={current.userAnswer === undefined || currentIndex === total - 1}
          className="rounded-lg bg-gradient-to-r from-cyan-400 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
        >
          Далее
        </button>
      </div>

      {answered === total && total > 0 && (
        <div className="rounded-xl border border-white/10 bg-emerald-400/10 px-4 py-3 text-sm text-white">
          <p className="font-semibold">Результат</p>
          <p>
            Правильно: {correct} из {total} ({percent}%)
          </p>
        </div>
      )}
    </div>
  );
}

function InfographicView({ data }: { data: InfographicSpec }) {
  return (
    <div className="space-y-3">
      <p className="text-lg font-semibold text-white">{data.title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.blocks.map((b, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-sm font-semibold text-white mb-1">{b.title}</p>
            <p className="text-sm text-slate-200 leading-relaxed">{b.content}</p>
          </div>
        ))}
      </div>
      {data.takeaway && (
        <div className="rounded-xl border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-white">
          {data.takeaway}
        </div>
      )}
    </div>
  );
}

function SlidesView({ data }: { data: SlidesSpec }) {
  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold text-white">{data.title}</p>
      <div className="space-y-3">
        {data.slides.map((s, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-sm font-semibold text-white mb-2">Слайд {i + 1}: {s.title}</p>
                        <ul className="list-disc pl-4 text-sm text-slate-200 space-y-1">
                          {s.bullets.map((b, bi) => (
                            <li key={bi}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }        
        function AudioPlayerView({ data }: { data: AudioSpec }) {
          const [isPlaying, setIsPlaying] = useState(false);
          const [currentTime, setCurrentTime] = useState(0);
          const [duration, setDuration] = useState(0);
          const audioRef = useRef<HTMLAudioElement | null>(null);
        
          const togglePlay = () => {
            if (audioRef.current) {
              if (isPlaying) {
                audioRef.current.pause();
              } else {
                audioRef.current.play();
              }
              setIsPlaying(!isPlaying);
            }
          };
        
          const skip = (seconds: number) => {
            if (audioRef.current) {
              audioRef.current.currentTime += seconds;
            }
          };
        
          const handleTimeUpdate = () => {
            if (audioRef.current) {
              setCurrentTime(audioRef.current.currentTime);
            }
          };
        
          const handleLoadedMetadata = () => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
            }
          };
        
          const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
            const time = Number(e.target.value);
            if (audioRef.current) {
              audioRef.current.currentTime = time;
              setCurrentTime(time);
            }
          };
        
          const formatTime = (time: number) => {
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
          };
        
          return (
            <div className="rounded-xl bg-white/5 p-6 border border-white/10 space-y-6">
              <div className="text-center space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Аудиоподкаст</p>
                <p className="text-xl font-semibold text-white">{data.title}</p>
              </div>
        
              <div className="flex items-center justify-center">
                <div className="h-32 w-32 rounded-full bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-white/10 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
                   <span className="text-4xl">🎙️</span>
                </div>
              </div>
        
              <audio
                ref={audioRef}
                src={data.audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              />
        
              <div className="space-y-2">
                <input
                  type="range"
                  min={0}
                  max={duration}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:accent-cyan-300"
                />
                <div className="flex justify-between text-xs text-slate-400 font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
        
              <div className="flex items-center justify-center gap-6">
                <button onClick={() => skip(-15)} className="text-slate-400 hover:text-white transition" title="-15s">
                  ↺ 15s
                </button>
                
                <button
                  onClick={togglePlay}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-900 hover:bg-cyan-50 transition shadow-lg hover:shadow-cyan-500/20 hover:scale-105"
                >
                  {isPlaying ? (
                    <span className="text-2xl">⏸</span>
                  ) : (
                    <span className="ml-1 text-2xl">▶</span>
                  )}
                </button>
        
                <button onClick={() => skip(15)} className="text-slate-400 hover:text-white transition" title="+15s">
                  15s ↻
                </button>
              </div>
            </div>
          );
        }
                
        

function VideoView({ data }: { data: VideoSpec }) {
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentScene = data.scenes[currentSceneIdx];

  const playAudioForScene = (index: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const scene = data.scenes[index];
    if (scene.audio) {
        const audio = new Audio(scene.audio);
        audioRef.current = audio;
        audio.onended = handleSceneEnd;
        audio.play().catch(e => console.error("Play error", e));
    } else {
        // Fallback if audio generation failed on server
        console.warn("No audio for scene, falling back to silence/timer");
        setTimeout(handleSceneEnd, 3000); 
    }
  };

  const handleSceneEnd = () => {
    if (currentSceneIdx < data.scenes.length - 1) {
      setCurrentSceneIdx((p) => p + 1);
    } else {
      setIsPlaying(false);
    }
  };

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  };

  const handlePlay = () => {
    if (currentSceneIdx >= data.scenes.length) {
      setCurrentSceneIdx(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying(true);
  };

  useEffect(() => {
    if (isPlaying) {
      playAudioForScene(currentSceneIdx);
    } else {
      if (audioRef.current) audioRef.current.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentSceneIdx]);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div className="space-y-4">
      <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-white/10 group">
        {currentScene.image ? (
          <img
            src={`data:image/jpeg;base64,${currentScene.image}`}
            alt={currentScene.text}
            className="h-full w-full object-contain" // Removed scale-110 transition
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800">
            <p className="text-slate-500">Нет изображения</p>
          </div>
        )}
        
        {/* Removed gradient overlay and subtitles */}

        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40">
            <button
              onClick={handlePlay}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-md transition hover:scale-110 hover:bg-white/30"
            >
              <span className="ml-1 text-3xl">▶</span>
            </button>
          </div>
        )}

        {/* Fullscreen Button */}
        <button 
            onClick={toggleFullscreen}
            className="absolute top-2 right-2 p-2 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/60"
            title="На весь экран"
        >
            ⛶
        </button>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
            <button onClick={() => { stop(); setCurrentSceneIdx(Math.max(0, currentSceneIdx - 1)); }} disabled={currentSceneIdx === 0} className="text-slate-400 hover:text-white">⏮</button>
            <span className="text-xs text-slate-400">
            {currentSceneIdx + 1} из {data.scenes.length}
            </span>
            <button onClick={() => { stop(); setCurrentSceneIdx(Math.min(data.scenes.length - 1, currentSceneIdx + 1)); }} disabled={currentSceneIdx === data.scenes.length - 1} className="text-slate-400 hover:text-white">⏭</button>
        </div>
        <button
            onClick={isPlaying ? stop : handlePlay}
            className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
        >
            {isPlaying ? "Пауза" : "Смотреть"}
        </button>
      </div>

      <div className="space-y-2 max-h-40 overflow-y-auto rounded-xl border border-white/5 bg-white/5 p-3">
          {data.scenes.map((s, i) => (
              <button key={i} onClick={() => { stop(); setCurrentSceneIdx(i); setIsPlaying(true); }} className={cx("w-full text-left text-xs p-2 rounded hover:bg-white/5 transition", i === currentSceneIdx ? "text-cyan-300 bg-white/10" : "text-slate-400")}>
                  <span className="font-bold mr-2">{i+1}.</span>
                  {s.text}
              </button>
          ))}
      </div>
    </div>
  );
}
