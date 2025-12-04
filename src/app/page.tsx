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

type ParsedQuiz = {
  quiz?: QuizQuestion[];
  message: string;
};

type InfographicSpec = { title: string; blocks: { title: string; content: string }[]; takeaway?: string };
type SlidesSpec = { title: string; slides: { title: string; bullets: string[]; image?: string | null }[] };
type VideoSpec = { title: string; scenes: { text: string; visual: string; image?: string | null; audio?: string | null }[] };
type AudioSpec = {
  title: string;
  audioUrl: string;
};

type JobDetails = {
  title: string;
  description: string;
  requirements: string;
};

type StudyResource = {
  title: string;
  url: string;
  type: 'video' | 'book' | 'article' | 'course';
};

type StudyTopic = {
  name: string;
  resources: StudyResource[];
};

type StudyPlanModule = {
  week: number;
  title: string;
  description: string;
  topics: StudyTopic[];
  estimatedHours: number;
};

function extractQuiz(raw: string): ParsedQuiz {
  const codeBlockMatch = raw.match(/```json([\s\S]*?)```/i);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1] : (() => {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return raw.slice(start, end + 1);
    return raw;
  })();

  const parseQuestionsArray = (parsed: unknown) => {
    const obj = parsed as {
      questions?: unknown;
    };
    if (Array.isArray(obj.questions)) {
      const quiz = obj.questions
        .filter(
          (q: {
            question: unknown;
            options: unknown[];
          }) =>
            typeof q?.question === "string" &&
            Array.isArray(q?.options) &&
            q.options.length === 4 &&
            q.options.every((o) => typeof o === "string")
        )
        .map((q: {
          question: string;
          options: string[];
          answer?: number;
        }) => ({
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
    } catch {} 
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

  const optionRegex = /^[-*]?\s*[A-DА-Га-г][).]\s*(.+)$/i;
  const questionRegex = /^\d+[).]\s+(.+)/;

  for (const line of cleanedLines) {
    const qMatch = line.match(questionRegex);
    if (qMatch) {
      if (current && current.options.length === 4) quiz.push(current);
      current = {
        question: qMatch[1].trim(),
        options: [],
        answer: 0,
      };
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
        .filter((b: {
          title: unknown;
          content: unknown;
        }) => typeof b?.title === "string" && typeof b?.content === "string")
        .map((b: {
          title: string;
          content: string;
        }) => ({ title: b.title, content: b.content }));
      if (blocks.length) {
        return {
          title: String(parsed.title),
          blocks,
          takeaway: typeof parsed.takeaway === "string" ? parsed.takeaway : undefined,
        };
      }
    }
  } catch {} 
  return null;
}

function parseSlides(raw: string): SlidesSpec | null {
  try {
    const cleaned = raw.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed?.title && Array.isArray(parsed?.slides)) {
      const slides = parsed.slides
        .filter((s: {
          title: unknown;
          bullets: unknown[];
        }) => typeof s?.title === "string" && Array.isArray(s?.bullets))
        .map((s: {
          title: string;
          bullets: unknown[];
        }) => ({
          title: s.title,
          bullets: s.bullets.filter((b) => typeof b === "string") as string[],
        }))
        .filter((s: {
          bullets: string[];
        }) => s.bullets.length);
      if (slides.length) return { title: String(parsed.title), slides };
    }
  } catch {} 
  return null;
}

type FlashcardsSpec = {
  title: string;
  cards: { front: string; back: string }[];
};

function parseFlashcards(raw: string): FlashcardsSpec | null {
  try {
    const cleaned = raw.replace(/```json|```/gi, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.cards)) {
      const cards = parsed.cards
        .filter((c: { front: unknown; back: unknown }) => typeof c?.front === "string" && typeof c?.back === "string")
        .map((c: { front: string; back: string }) => ({ front: c.front, back: c.back }));
      
      if (cards.length) {
        return {
          title: typeof parsed.title === "string" ? parsed.title : "Карточки",
          cards,
        };
      }
    }
  } catch {}
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
  flashcards?: FlashcardsSpec;
  video?: VideoSpec;
  audioProject?: AudioSpec;
  image?: string;
};

const studioCards: StudioCard[] = [
  { key: "audio", title: "Подкаст", desc: "", gradient: "from-sky-400/50 to-cyan-500/30" },
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

const Icons = {
  File: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
  ),
  Link: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
  ),
  Youtube: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>
  ),
  Text: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M12 18H8"/><path d="M16 14H8"/><path d="M16 10H8"/></svg>
  ),
  Mic: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
  ),
  Video: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>
  ),
  Layers: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m12.83 2.46 5.79 2.41a2 2 0 0 1 0 3.69l-5.79 2.41a2 2 0 0 1-1.66 0L5.38 8.56a2 2 0 0 1 0-3.69l5.79-2.41a2 2 0 0 1 1.66 0Z"/><path d="m22 10-7.93 3.3a2 2 0 0 1-1.66 0L2 10"/><path d="m22 14-7.93 3.3a2 2 0 0 1-1.66 0L2 14"/><path d="m22 18-7.93 3.3a2 2 0 0 1-1.66 0L2 18"/></svg>
  ),
  Brain: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>
  ),
  PieChart: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
  ),
  Presentation: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
  ),
  Briefcase: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
  ),
};

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
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isCareerOpen, setCareerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState<string>("");
  const [modalContent, setModalContent] = useState<string>("");
  const [modalQuiz, setModalQuiz] = useState<QuizQuestion[] | null>(null);
  const [modalInfographic, setModalInfographic] = useState<InfographicSpec | null>(null);
  const [modalSlides, setModalSlides] = useState<SlidesSpec | null>(null);
  const [modalFlashcards, setModalFlashcards] = useState<FlashcardsSpec | null>(null);
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
      setActiveTab(null);
      data.sources.forEach((s: Source) => {
        if (s.summary) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: s.summary! },
          ]);
        }
      });
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
      if (data.source.summary) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.source.summary! },
        ]);
      }
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
      if (data.source.summary) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.source.summary! },
        ]);
      }
    }
  };

  const handleTextAdd = async () => {
    if (!textSource.trim()) return;
    
    let summary = "";
    try {
        const res = await fetch("/api/summary", {
            method: "POST",
            body: JSON.stringify({ text: textSource }),
            headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.summary) summary = data.summary;
    } catch (e) {
        console.error("Summary fetch failed", e);
    }

    const source: Source = {
      id: uuid(),
      title: textTitle || "Текст",
      type: "text",
      content: textSource,
      summary,
    };
    setSources((prev) => [...prev, source]);
    setSelectedSources((prev) => [...prev, source.id]);
    setTextSource("");
    setTextTitle("Свободный текст");
    setActiveTab(null);
    if (source.summary) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: source.summary! },
      ]);
    }
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
      const reply: ChatMessage = {
        role: "assistant",
        content: data.text || data.error || "Не удалось сгенерировать ответ",
      };
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
      job_plan: "Создай учебный план.",
      job_quiz: "Создай тест.",
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
      let slidesPayload: SlidesSpec | undefined = data.slides; // Use data.slides if available
      let flashcardsPayload: FlashcardsSpec | undefined = undefined;
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
        if (slidesPayload) {
             content = "Презентация готова. Нажмите, чтобы посмотреть.";
        } else {
            // Fallback to legacy parsing if API didn't return structured slides
            const parsed = parseSlides(content);
            if (parsed) {
                slidesPayload = parsed;
                content = "Презентация готова. Нажмите, чтобы посмотреть.";
            }
        }
      } else if (mode === "flashcards") {
        const parsed = parseFlashcards(content);
        if (parsed) {
          flashcardsPayload = parsed;
          content = "Карточки готовы. Нажмите, чтобы посмотреть.";
        }
      } else if (mode === "video" && videoPayload) {
        content = "Видео готово. Нажмите, чтобы посмотреть.";
      } else if (mode === "audio" && audioPayload) {
        content = "Подкаст готов. Нажмите, чтобы слушать.";
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
                flashcards: flashcardsPayload,
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
    <div className="h-screen flex flex-col overflow-hidden px-3 pt-4 pb-4 sm:px-4 lg:px-6 xl:px-10">
      <div className="mx-auto flex w-full flex-1 flex-col gap-5 lg:gap-6 min-h-0">
        <header className="flex items-center justify-between rounded-2xl glass px-4 py-2 shadow-lg no-hover-outline">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="MIRAVERSE" className="h-16 w-auto brightness-200 saturate-300" />
            <div>
              <p className="text-sm text-slate-300">ИИ Репетитор </p>
              <h1 className="text-lg font-semibold text-white">M I R A V E R S E</h1>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
             <button
              onClick={() => setCareerOpen(true)}
              className="group flex items-center gap-2 rounded-xl bg-white/5 px-3 py-4 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white border border-white/5 hover:border-white/10"
            >
              <Icons.Briefcase className="h-6 w-6 text-slate-400 group-hover:text-cyan-600 transition-colors" />
              <span>Карьера</span>
            </button>
            
            <button 
              onClick={() => setProfileOpen(true)}
              className="group flex items-center gap-2 rounded-xl bg-white/5 px-3 py-3 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all"
            >
              <span className="text-sm font-medium text-slate-300 group-hover:text-white">Профиль</span>
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shadow-inner">
                AB
              </div>
            </button>
          </div>
        </header>

        <div className="layout-grid pb-4 flex-1 min-h-0">
          {/* Sidebar */}
          <aside className="glass-strong dot-grid rounded-2xl p-4 h-full flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div>
                {/* <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Источники данных</p> */}
                <h2 className="text-xl font-semibold text-slate-300">Источники данных</h2>
              </div>
              {/* <button
                onClick={() => setSelectedSources(sources.map((s) => s.id))}
                className="text-xs text-cyan-200 hover:text-cyan-100"
              >
                Выбрать все
              </button> */}
            </div>

            <div className="space-y-4">
              <div className="flex gap-2 bg-black/20 p-1 rounded-xl">
                <button
                  onClick={() => setActiveTab(activeTab === "file" ? null : "file")}
                  className={cx(
                    "flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg transition-all duration-200",
                    activeTab === "file" 
                      ? "bg-cyan-600 text-slate-900 shadow-lg shadow-cyan-600/20 font-semibold" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <Icons.File className="w-5 h-5" />
                  <span className="text-[10px] tracking-wide">Файл</span>
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === "link" ? null : "link")}
                  className={cx(
                    "flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg transition-all duration-200",
                    activeTab === "link" 
                      ? "bg-cyan-700 text-slate-900 shadow-lg shadow-cyan-700/20 font-semibold" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <Icons.Link className="w-5 h-5" />
                  <span className="text-[10px] tracking-wide">Ссылка</span>
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === "youtube" ? null : "youtube")}
                  className={cx(
                    "flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg transition-all duration-200",
                    activeTab === "youtube" 
                      ? "bg-cyan-600 text-slate-900 shadow-lg shadow-cyan-600/20 font-semibold" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <Icons.Youtube className="w-5 h-5" />
                  <span className="text-[10px] tracking-wide">YouTube</span>
                </button>
                <button
                  onClick={() => setActiveTab(activeTab === "text" ? null : "text")}
                  className={cx(
                    "flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg transition-all duration-200",
                    activeTab === "text" 
                      ? "bg-cyan-600 text-slate-900 shadow-lg shadow-cyan-600/20 font-semibold" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <Icons.Text className="w-5 h-5" />
                  <span className="text-[10px] tracking-wide">Текст</span>
                </button>
              </div>

              {/* Dynamic forms */}
              {activeTab === "file" && (
                <div className="glass rounded-xl p-6 text-center space-y-3 border-dashed border-2 border-white/10 hover:border-cyan-400/30 transition-colors">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-2">
                    <Icons.File className="w-6 h-6 text-slate-300" />
                  </div>
                  <div>
                     <p className="text-sm font-medium text-white">Загрузите документы</p>
                     <p className="text-xs text-slate-400 mt-1">PDF, DOCX, TXT до 10МБ</p>
                  </div>
                  <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
                  >
                    Выбрать файлы
                  </button>
                </div>
              )}
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

              <div className="mt-3 space-y-2 flex-1 overflow-y-auto min-h-0 pr-1">
                {sources.length === 0 && (
                  <p className="text-sm text-slate-400">Добавьте PDF, ссылки, видео или текст.</p>
                )}
                {sources.map((src) => (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id)}
                    className={cx(
                      "w-full rounded-xl px-3 py-2 text-left glass border border-transparent transition",
                      selectedSources.includes(src.id) && "border-cyan-600/50 shadow-[0_0_0_1px_rgba(103,232,249,0.2)]"
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
          <section className="glass-strong rounded-2xl p-4 flex flex-col h-full self-stretch min-h-0">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                {/* <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Чат с репетитором</p> */}
                <h2 className="text-xl font-semibold text-slate-300">Чат с репетитором</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-300" /> MIRAVERSE AI подключен
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={cx(
                    "rounded-2xl px-3 py-2 max-w-3xl transition border border-transparent hover:border-blue-300/60 hover:shadow-[0_0_0_1px_rgba(96,165,250,0.35)]",
                    m.role === "assistant" ? "bg-white/5" : "bg-cyan-500/20 border border-cyan-600/30 ml-auto"
                  )}
                > 
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
                    className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 border border-white/10 hover:border-cyan-600/50"
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
          <aside className="glass-strong dot-grid rounded-2xl p-4 space-y-3 h-full self-stretch flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
              <div>
                {/* <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Студия</p> */}
                <h2 className="text-xl font-semibold text-slate-300">Инструменты</h2>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {studioCards.filter(card => card.key !== "mindmap" && card.key !== "report").map((card) => {
                const IconComponent = {
                  audio: Icons.Mic,
                  video: Icons.Video,
                  flashcards: Icons.Layers,
                  quiz: Icons.Brain,
                  infographic: Icons.PieChart,
                  slides: Icons.Presentation,
                }[card.key as string] || Icons.File;

                return (
                  <button
                    key={card.key}
                    onClick={() => runStudio(card.key)}
                    className="group flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:border-cyan-400/50 hover:bg-white/10 hover:shadow-lg hover:shadow-cyan-500/10"
                  >
                    <div className={cx(
                      "flex h-10 w-10 items-center justify-center rounded-lg transition-all group-hover:scale-110",
                      card.key === "audio" && "bg-sky-500/20 text-sky-300",
                      card.key === "video" && "bg-emerald-500/20 text-emerald-300",
                      card.key === "flashcards" && "bg-pink-500/20 text-pink-300",
                      card.key === "quiz" && "bg-indigo-500/20 text-indigo-300",
                      card.key === "infographic" && "bg-lime-500/20 text-lime-300",
                      card.key === "slides" && "bg-fuchsia-500/20 text-fuchsia-300",
                    )}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-medium text-slate-300 group-hover:text-white">{card.title}</span>
                  </button>
                );
              })}
            </div>
            <div className="glass mt-2 rounded-2xl border border-white/10 p-3 flex-1 flex flex-col min-h-0 space-y-2 overflow-hidden">
              {/* <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Результаты</p> */}
              {studioResults.length === 0 && (
                <p className="text-sm text-slate-400 shrink-0"></p>
              )}
              <div className="space-y-2 flex-1 overflow-y-auto pr-1">
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
                      let parsedFlashcards = item.flashcards;
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

                      if (!parsedFlashcards && item.mode === "flashcards") {
                        parsedFlashcards = parseFlashcards(item.content) ?? undefined;
                        if (parsedFlashcards) parsedContent = "Карточки готовы. Нажмите, чтобы посмотреть.";
                      }

                      setModalTitle(item.title);
                      setModalContent(parsedContent);
                      setModalQuiz(parsedQuiz ? parsedQuiz.map((q) => ({ ...q })) : null);
                      setModalInfographic(parsedInfographic ?? null);
                      setModalSlides(parsedSlides ?? null);
                      setModalFlashcards(parsedFlashcards ?? null);
                      setModalVideo(parsedVideo ?? null);
                      setModalAudio(parsedAudio ?? null);
                      setModalImage(item.image ?? null);
                      setModalOpen(true);
                    }}
                    className={cx(
                      "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition",
                      item.status === "loading" && "opacity-70",
                      "hover:border-cyan-600/50"
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

      {isCareerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full rounded-2xl bg-slate-900/95 border border-white/10 shadow-2xl overflow-hidden h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-white/5 flex-shrink-0">
              <div className="flex items-center gap-3">
                 <span className="text-xl">💼</span>
                 <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Карьера</p>
              </div>
              <button
                onClick={() => setCareerOpen(false)}
                className="text-slate-300 hover:text-white p-2 hover:bg-white/10 rounded-lg transition"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 bg-[#020617]">
              <JobPrepView />
            </div>
          </div>
        </div>
      )}

      {isProfileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-6xl rounded-2xl bg-slate-900/95 border border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-white/5">
              <div className="flex items-center gap-3">
                 <span className="text-xl">🎓</span>
                 <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Паспорт компетенций</p>
              </div>
              <button
                onClick={() => setProfileOpen(false)}
                className="text-slate-300 hover:text-white p-2 hover:bg-white/10 rounded-lg transition"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[85vh] overflow-y-auto px-6 py-6 bg-[#020617]">
              <SkillsPassportView />
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className={cx("relative w-full rounded-2xl bg-slate-900/90 border border-white/10 shadow-2xl", (modalImage || modalSlides || modalVideo) ? "max-w-7xl" : "max-w-3xl")}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-300">{modalTitle || "Результат"}</p>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[85vh] overflow-y-auto px-4 py-4 space-y-3 text-[15px] leading-relaxed">
              {studioLoading ? (
                <p className="text-base text-slate-200">Генерация...</p>
              ) : modalQuiz ? (
                <QuizView quiz={modalQuiz} setQuiz={setModalQuiz} />
              ) : modalInfographic ? (
                <InfographicView data={modalInfographic} />
              ) : modalSlides ? (
                <SlidesView data={modalSlides} />
              ) : modalFlashcards ? (
                <FlashcardsView data={modalFlashcards} />
              ) : modalVideo ? (
                <VideoView data={modalVideo} />
              ) : modalAudio ? (
                <AudioPlayerView data={modalAudio} />
              ) : modalImage ? (
                <div className="flex justify-center">
                  <img src={`data:image/jpeg;base64,${modalImage}`} alt="Infographic" className="rounded-xl max-w-full h-auto object-contain max-h-[75vh]" />
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
                className="rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:border-cyan-600/60"
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
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);

  const nextSlide = () => {
    setCurrentSlideIdx((prev) => Math.min(data.slides.length - 1, prev + 1));
  };

  const prevSlide = () => {
    setCurrentSlideIdx((prev) => Math.max(0, prev - 1));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nextSlide();
      if (e.key === "ArrowLeft") prevSlide();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.slides.length]);

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

  const currentSlide = data.slides[currentSlideIdx];

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Презентация</p>
        <p className="text-xl font-semibold text-white">{data.title}</p>
      </div>

      <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-white/10 shadow-2xl group">
        {currentSlide.image ? (
          <img
            src={`data:image/jpeg;base64,${currentSlide.image}`}
            alt={currentSlide.title}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-slate-800 p-10 text-center">
            <p className="text-4xl">📊</p>
            <h3 className="text-2xl font-bold text-white">{currentSlide.title}</h3>
            <ul className="space-y-2 text-left">
                {currentSlide.bullets.map((b, i) => (
                    <li key={i} className="text-slate-300">• {b}</li>
                ))}
            </ul>
          </div>
        )}

        {/* Navigation Overlays */}
        <button
          onClick={prevSlide}
          disabled={currentSlideIdx === 0}
          className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-black/50 to-transparent opacity-0 hover:opacity-100 disabled:hidden transition flex items-center justify-start pl-4 text-white text-4xl"
        >
          ‹
        </button>
        <button
          onClick={nextSlide}
          disabled={currentSlideIdx === data.slides.length - 1}
          className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-black/50 to-transparent opacity-0 hover:opacity-100 disabled:hidden transition flex items-center justify-end pr-4 text-white text-4xl"
        >
          ›
        </button>

        <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
            <span className="text-xs font-bold text-white">
                {currentSlideIdx + 1} / {data.slides.length}
            </span>
        </div>

        {/* Fullscreen Button */}
        <button 
            onClick={toggleFullscreen}
            className="absolute top-2 right-2 p-2 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/60 z-10"
            title="На весь экран"
        >
            ⛶
        </button>
      </div>

      <div className="flex justify-center gap-4">
        <button
            onClick={prevSlide}
            disabled={currentSlideIdx === 0}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-50"
        >
            Назад
        </button>
        <button
            onClick={toggleFullscreen}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-cyan-600 hover:bg-white/10 hover:text-cyan-200"
        >
            Развернуть
        </button>
        <button
            onClick={nextSlide}
            disabled={currentSlideIdx === data.slides.length - 1}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-cyan-400 disabled:opacity-50 border border-transparent"
        >
            Далее
        </button>
      </div>
    </div>
  );
}

function FlashcardsView({ data }: { data: FlashcardsSpec }) {
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const nextCard = () => {
    setIsFlipped(false);
    setTimeout(() => setCurrentCardIdx((prev) => Math.min(data.cards.length - 1, prev + 1)), 150);
  };

  const prevCard = () => {
    setIsFlipped(false);
    setTimeout(() => setCurrentCardIdx((prev) => Math.max(0, prev - 1)), 150);
  };

  const currentCard = data.cards[currentCardIdx];

  return (
    <div className="space-y-6 flex flex-col items-center">
      <div className="text-center space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-pink-400">Карточки</p>
        <p className="text-xl font-semibold text-white">{data.title}</p>
      </div>

      <div className="relative w-full max-w-md aspect-[3/2] perspective-1000 group cursor-pointer" onClick={() => setIsFlipped(!isFlipped)}>
        <div className={cx("relative w-full h-full transition-all duration-500 transform-style-3d shadow-2xl rounded-2xl", isFlipped && "rotate-y-180")}>
          {/* Front */}
          <div className="absolute inset-0 w-full h-full backface-hidden rounded-2xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex flex-col items-center justify-center p-6 text-center">
            <span className="text-4xl mb-4">❓</span>
            <p className="text-xl font-medium text-white">{currentCard.front}</p>
            <p className="absolute bottom-4 text-xs text-slate-400 uppercase tracking-widest">Нажмите, чтобы узнать ответ</p>
          </div>

          {/* Back */}
          <div className="absolute inset-0 w-full h-full backface-hidden rotate-y-180 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex flex-col items-center justify-center p-6 text-center">
             <span className="text-4xl mb-4">💡</span>
             <p className="text-lg text-slate-100">{currentCard.back}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6 text-white select-none">
        <button
          onClick={(e) => { e.stopPropagation(); prevCard(); }}
          disabled={currentCardIdx === 0}
          className="p-3 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 transition"
        >
          ←
        </button>
        <span className="font-mono text-sm text-slate-400">
          {currentCardIdx + 1} / {data.cards.length}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); nextCard(); }}
          disabled={currentCardIdx === data.cards.length - 1}
          className="p-3 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 transition"
        >
          →
        </button>
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
          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:accent-cyan-600"
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
    } else { // Fallback if audio generation failed on server
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
            className="text-sm font-semibold text-cyan-400 hover:text-cyan-600"
        >
            {isPlaying ? "Пауза" : "Смотреть"}
        </button>
      </div>

      <div className="space-y-2 max-h-40 overflow-y-auto rounded-xl border border-white/5 bg-white/5 p-3">
          {data.scenes.map((s, i) => (
              <button key={i} onClick={() => { stop(); setCurrentSceneIdx(i); setIsPlaying(true); }} className={cx("w-full text-left text-xs p-2 rounded hover:bg-white/5 transition", i === currentSceneIdx ? "text-cyan-600 bg-white/10" : "text-slate-400")}>
                  <span className="font-bold mr-2">{i+1}.</span>
                  {s.text}
              </button>
          ))}
      </div>
    </div>
  );
}

// Job Prep Component
function JobPrepView() {
  const [step, setStep] = useState<'input' | 'dashboard' | 'plan' | 'test'>('input');
  const [jobDetails, setJobDetails] = useState<JobDetails>({
    title: '',
    description: '',
    requirements: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  
  // Data State
  const [studyPlan, setStudyPlan] = useState<StudyPlanModule[]>([]);
  const [testQuestions, setTestQuestions] = useState<QuizQuestion[]>([]);
  const [quizQuestionCount, setQuizQuestionCount] = useState(10);
  
  // Test State
  const [userAnswers, setUserAnswers] = useState<number[]>([]);
  const [showTestResults, setShowTestResults] = useState(false);

  const handleCreatePlan = async () => {
    if (!jobDetails.title || !jobDetails.requirements) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "job_plan",
          prompt: JSON.stringify(jobDetails),
          sources: [], 
        }),
      });
      const data = await res.json();
      if (data.error || !data.text) {
        throw new Error(data.error || "Нет ответа от сервера");
      }
      // Parse JSON from text response
      const cleanJson = data.text.replace(/```json|```/gi, "").trim();
      const plan = JSON.parse(cleanJson);
      setStudyPlan(plan);
      setStep('dashboard');
    } catch (e) {
      console.error(e);
      alert("Не удалось создать план. " + (e instanceof Error ? e.message : ""));
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartTest = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "job_quiz",
          prompt: `Job: ${jobDetails.title}. Requirements: ${jobDetails.requirements}. Count: ${quizQuestionCount}`,
          sources: [],
        }),
      });
      const data = await res.json();
      if (data.error || !data.text) {
        throw new Error(data.error || "Нет ответа от сервера");
      }
      const cleanJson = data.text.replace(/```json|```/gi, "").trim();
      const questions = JSON.parse(cleanJson).map((q: any) => ({
        question: q.question,
        options: q.options,
        answer: q.answer, // Ensure backend returns 'answer' index
        explanation: q.explanation // Add explanation field to type if needed, generic QuizQuestion might not have it but we can extend
      }));
      
      setTestQuestions(questions);
      setUserAnswers(new Array(questions.length).fill(-1));
      setShowTestResults(false);
      setStep('test');
    } catch (e) {
      console.error(e);
      alert("Не удалось создать тест. " + (e instanceof Error ? e.message : ""));
    } finally {
      setIsLoading(false);
    }
  };

  const calculateTestScore = () => {
    return userAnswers.reduce((acc, ans, idx) => {
      return ans === testQuestions[idx].answer ? acc + 1 : acc;
    }, 0);
  };

  if (step === 'input') {
    return (
      <div className="glass rounded-2xl p-8 max-w-2xl mx-auto border border-white/10">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/20 text-indigo-300 mb-4 border border-indigo-500/30">
            <span className="text-3xl">💼</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Подготовка к Собеседованию</h2>
          <p className="text-slate-400 mt-2">Введите детали вакансии. ИИ составит учебный план и тест для проверки знаний.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-1">Название вакансии</label>
            <input 
              type="text" 
              value={jobDetails.title}
              onChange={(e) => setJobDetails({...jobDetails, title: e.target.value})}
              placeholder="напр. Senior Frontend Engineer"
              className="w-full p-3 bg-white/5 border border-white/10 rounded-xl focus:border-cyan-400/50 outline-none text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-1">Описание и Обязанности</label>
            <textarea 
              value={jobDetails.description}
              onChange={(e) => setJobDetails({...jobDetails, description: e.target.value})}
              placeholder="Вставьте основные обязанности..."
              className="w-full p-3 bg-white/5 border border-white/10 rounded-xl focus:border-cyan-400/50 outline-none h-36 resize-none text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-1">Требования и Навыки</label>
            <textarea 
              value={jobDetails.requirements}
              onChange={(e) => setJobDetails({...jobDetails, requirements: e.target.value})}
              placeholder="Список требуемых навыков (напр. React, TypeScript, AWS)..."
              className="w-full p-3 bg-white/5 border border-white/10 rounded-xl focus:border-cyan-400/50 outline-none h-36 resize-none text-white"
            />
          </div>

          <button 
            onClick={handleCreatePlan}
            disabled={isLoading || !jobDetails.title}
            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
          >
            {isLoading ? 'Анализ вакансии...' : 'Составить План Подготовки'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'dashboard') {
    return (
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <button onClick={() => setStep('input')} className="text-sm text-slate-400 hover:text-cyan-600 mb-2 flex items-center gap-1 transition-colors">
            ← Начать заново
          </button>
          <h2 className="text-3xl font-bold text-white">Подготовка: {jobDetails.title}</h2>
          <p className="text-slate-400">Ваша персонализированная дорожная карта.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Study Plan */}
          <div 
            onClick={() => setStep('plan')}
            className="glass p-8 rounded-2xl border border-white/10 cursor-pointer hover:border-cyan-400/50 hover:bg-white/5 transition-all group"
          >
            <div className="w-12 h-12 bg-blue-500/20 text-blue-300 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform border border-blue-500/30">
              <span className="text-2xl">📅</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Учебный План</h3>
            <p className="text-slate-400 mb-4">Структурированный план из {studyPlan.length} модулей, охватывающий все ключевые требования.</p>
            <span className="text-cyan-400 font-medium text-sm group-hover:text-cyan-600">Открыть План →</span>
          </div>

          {/* Card 2: Readiness Test */}
          <div 
            className="glass p-8 rounded-2xl border border-white/10 transition-all group relative overflow-hidden flex flex-col justify-between hover:border-purple-400/50 hover:bg-white/5"
          >
            {isLoading && (
              <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-10 backdrop-blur-sm">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
              </div>
            )}
            
            <div>
              <div className="w-12 h-12 bg-purple-500/20 text-purple-300 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform border border-purple-500/30">
                <span className="text-2xl">📝</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Оценка Готовности</h3>
              <p className="text-slate-400 mb-4">Пройдите технический тест, чтобы проверить готовность к интервью.</p>
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
               <div className="flex items-center justify-between mb-4">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Вопросы</label>
                  <select 
                    value={quizQuestionCount}
                    onChange={(e) => setQuizQuestionCount(parseInt(e.target.value))}
                    className="text-sm bg-slate-900 border border-white/20 rounded px-2 py-1 outline-none focus:border-purple-500 text-slate-300"
                    onClick={(e) => e.stopPropagation()}
                  >
                      <option value={5}>5 Вопросов</option>
                      <option value={10}>10 Вопросов</option>
                      <option value={15}>15 Вопросов</option>
                      <option value={20}>20 Вопросов</option>
                  </select>
               </div>
               
               <button 
                 onClick={handleStartTest}
                 className="w-full py-2 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm border border-purple-500/50"
               >
                  Начать Тестирование
               </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'plan') {
    return (
      <div className="max-w-4xl mx-auto">
        <button onClick={() => setStep('dashboard')} className="text-sm text-slate-400 hover:text-cyan-600 mb-6 flex items-center gap-2 transition-colors">
          ← Назад
        </button>
        
        <h2 className="text-2xl font-bold text-white mb-6">Учебный План для {jobDetails.title}</h2>
        
        <div className="space-y-6">
          {studyPlan.map((module, idx) => (
            <div key={idx} className="glass rounded-xl border border-white/10 overflow-hidden">
              <div className="bg-white/5 border-b border-white/10 p-4 flex justify-between items-center">
                <h3 className="font-bold text-slate-200">Модуль {module.week}: {module.title}</h3>
                <span className="text-xs font-semibold bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded border border-indigo-500/30">~{module.estimatedHours} Часов</span>
              </div>
              <div className="p-6">
                <p className="text-slate-400 mb-6 leading-relaxed">{module.description}</p>
                
                <div className="grid gap-4">
                   {module.topics.map((topic, tIdx) => (
                     <div key={tIdx} className="bg-white/5 border border-white/5 rounded-lg p-4 hover:border-indigo-500/30 transition-colors">
                        <h4 className="font-bold text-slate-300 text-sm mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                          {topic.name}
                        </h4>
                        
                        {topic.resources && topic.resources.length > 0 ? (
                          <div className="space-y-2 ml-4">
                            {topic.resources.map((res, rIdx) => (
                              <a 
                                key={rIdx} 
                                href={res.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 transition-colors group"
                              >
                                <div className="flex-shrink-0 text-slate-500 group-hover:text-indigo-400">
                                  <span className="text-lg">
                                    {res.type === 'video' ? '▶️' : res.type === 'book' ? '📚' : '📄'}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-indigo-300 truncate group-hover:text-indigo-200">{res.title}</p>
                                  <p className="text-[10px] text-slate-500 truncate">{res.url}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 ml-4 italic">Нет ресурсов.</p>
                        )}
                     </div>
                   ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (step === 'test') {
    return (
      <div className="max-w-3xl mx-auto">
        <button onClick={() => setStep('dashboard')} className="text-sm text-slate-400 hover:text-cyan-600 mb-6 flex items-center gap-2 transition-colors">
          ← Завершить Тест
        </button>

        <div className="space-y-6">
          {testQuestions.map((q, qIdx) => {
            const isAnswered = userAnswers[qIdx] !== -1;
            const isCorrect = userAnswers[qIdx] === q.answer;
            
            return (
              <div key={qIdx} className="glass p-6 rounded-2xl border border-white/10">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold text-slate-200">Вопрос {qIdx + 1}</h3>
                  {showTestResults && (
                    <span className={`text-xs font-bold px-2 py-1 rounded uppercase ${isCorrect ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}`}>
                      {isCorrect ? 'Верно' : 'Неверно'}
                    </span>
                  )}
                </div>
                <p className="text-slate-300 mb-4">{q.question}</p>
                
                <div className="space-y-2">
                  {q.options.map((opt, optIdx) => {
                    let btnClass = "w-full text-left p-3 rounded-lg border text-sm transition-all ";
                    
                    if (showTestResults) {
                      if (optIdx === q.answer) {
                        btnClass += "bg-emerald-500/20 border-emerald-500/50 text-emerald-200 font-medium ";
                      } else if (optIdx === userAnswers[qIdx] && optIdx !== q.answer) {
                        btnClass += "bg-rose-500/20 border-rose-500/50 text-rose-300 ";
                      } else {
                        btnClass += "border-white/5 text-slate-500 opacity-50 ";
                      }
                    } else {
                      if (userAnswers[qIdx] === optIdx) {
                        btnClass += "bg-indigo-500/30 border-indigo-500 text-white font-medium ring-1 ring-indigo-500/50";
                      } else {
                        btnClass += "bg-white/5 border-white/10 hover:bg-white/10 text-slate-300 hover:text-white";
                      }
                    }

                    return (
                      <button
                        key={optIdx}
                        onClick={() => {
                          if (!showTestResults) {
                            const newAnswers = [...userAnswers];
                            newAnswers[qIdx] = optIdx;
                            setUserAnswers(newAnswers);
                          }
                        }}
                        className={btnClass}
                        disabled={showTestResults}
                      >
                        <span className="inline-block w-6 font-bold opacity-40 mr-2">{String.fromCharCode(65 + optIdx)}.</span>
                        {opt}
                      </button>
                    );
                  })}
                </div>

                {showTestResults && (q as any).explanation && (
                  <div className="mt-4 p-4 bg-blue-500/10 text-blue-200 rounded-lg text-sm border border-blue-500/20">
                    <strong className="font-semibold block mb-1 text-blue-100">Пояснение:</strong>
                    {(q as any).explanation}
                  </div>
                )}
              </div>
            );
          })}

          {!showTestResults ? (
            <button 
              onClick={() => setShowTestResults(true)}
              disabled={userAnswers.includes(-1)}
              className="w-full bg-slate-100 text-slate-900 font-semibold py-4 rounded-xl hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              Отправить Ответы
            </button>
          ) : (
            <div className="text-center p-6 glass rounded-2xl border border-white/10">
              <p className="text-slate-400 mb-2">Ваш результат</p>
              <p className="text-4xl font-bold text-white mb-4">{calculateTestScore()} / {testQuestions.length}</p>
              <button 
                 onClick={() => setStep('plan')}
                 className="text-indigo-400 font-medium hover:text-indigo-300 hover:underline"
              >
                Вернуться к плану
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// Mock Data for Profile
const MOCK_PROFILE = {
  studentName: "Александр Волков",
  overallLevel: "Middle Junior",
  summary: "Студент 3-го курса направления «Бизнес-информатика». Демонстрирует высокие способности в моделировании процессов и анализе данных. Победитель студенческого хакатона 2024. Успешно завершил стажировку в финтех-секторе.",
  categories: [
    {
      categoryName: "Hard Skills (Профессиональные)",
      skills: [
        { name: "BPMN / Моделирование процессов", score: 92, reasoning: "Отличные оценки по курсовым проектам, сертификат Business Studio." },
        { name: "SQL & Управление данными", score: 78, reasoning: "Уверенное владение сложными запросами, опыт работы с PostgreSQL." },
        { name: "Python для анализа данных", score: 65, reasoning: "Базовое использование Pandas/NumPy в учебных проектах." },
        { name: "Системный анализ", score: 85, reasoning: "Высокая оценка за преддипломную практику." }
      ]
    },
    {
      categoryName: "Soft Skills (Гибкие навыки)",
      skills: [
        { name: "Командная работа", score: 88, reasoning: "Капитан команды на кейс-чемпионате Changellenge." },
        { name: "Презентация решений", score: 90, reasoning: "Выступление на научной конференции с докладом." },
        { name: "Критическое мышление", score: 75, reasoning: "Способность находить нестандартные решения в стрессовых ситуациях." }
      ]
    },
    {
      categoryName: "Инструментарий",
      skills: [
        { name: "Jira / Confluence", score: 80, reasoning: "Использование в рамках проектного семинара." },
        { name: "Tableau / PowerBI", score: 70, reasoning: "Создание дашбордов для курсовой работы." },
        { name: "Figma", score: 60, reasoning: "Прототипирование интерфейсов для MVP." }
      ]
    }
  ],
  recommendations: [
    "Углубить знания Python (библиотеки Scikit-learn) для перехода к Data Science задачам.",
    "Получить сертификацию начального уровня по управлению проектами (CAPM или PMP Junior).",
    "Развивать навыки технического английского языка для чтения документации в оригинале."
  ]
};

function SkillsPassportView() {
  const passport = MOCK_PROFILE;
  
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-emerald-500';
    if (score >= 75) return 'bg-teal-500';
    if (score >= 60) return 'bg-indigo-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-rose-500';
  };

  return (
    <div className="space-y-6">
      {/* Top Bar simulating System Status */}
      <div className="flex justify-between items-center bg-white/5 px-4 py-2 rounded-lg border border-white/10 text-xs text-slate-400">
         <div className="flex items-center gap-2">
           <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
           <span>Соединение с базой данных ВУЗа: Активно</span>
         </div>
         <div>
           Обновлено: {new Date().toLocaleDateString()}
         </div>
      </div>

      {/* Header Card */}
      <div className="glass rounded-3xl p-8 shadow-lg border border-white/10 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <svg className="w-80 h-80 text-cyan-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
        </div>
        
        <div className="relative z-10 w-28 h-28 bg-gradient-to-br from-teal-500 to-blue-600 rounded-full flex items-center justify-center text-white text-4xl font-bold shadow-xl border-4 border-white/10">
          {passport.studentName.split(' ')[0][0]}{passport.studentName.split(' ')[1][0]}
        </div>
        
        <div className="flex-1 text-center md:text-left relative z-10">
          <div className="flex flex-col md:flex-row md:items-center gap-2 mb-2 justify-center md:justify-start">
            <h1 className="text-3xl font-bold text-white">{passport.studentName}</h1>
            <span className="hidden md:inline text-slate-500">|</span>
            <span className="text-cyan-600 font-semibold bg-cyan-900/30 px-3 py-1 rounded-full text-sm border border-cyan-500/30">Бизнес-информатика</span>
          </div>
          
          <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-4">
            <div className="inline-flex items-center px-3 py-1 bg-white/10 text-slate-200 rounded-lg text-xs font-bold uppercase tracking-wider border border-white/10">
              Средний балл: 4.8
            </div>
            <div className="inline-flex items-center px-3 py-1 bg-indigo-500/20 text-indigo-200 rounded-lg text-xs font-bold uppercase tracking-wider border border-indigo-500/30">
              Уровень: {passport.overallLevel}
            </div>
          </div>

          <p className="text-slate-300 leading-relaxed bg-white/5 p-3 rounded-xl text-sm border border-white/10">
            <span className="font-bold text-slate-100">Резюме системы:</span> {passport.summary}
          </p>
        </div>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {passport.categories.map((cat, idx) => (
          <div key={idx} className="glass rounded-2xl p-6 border border-white/10 hover:border-cyan-500/30 transition-colors">
            <h3 className="text-lg font-bold text-white mb-6 border-b border-white/10 pb-2 flex items-center justify-between">
              {cat.categoryName.split('(')[0]}
              <span className="text-xs font-normal text-slate-400">{cat.categoryName.split('(')[1]?.replace(')', '')}</span>
            </h3>
            <div className="space-y-6">
              {cat.skills.map((skill, sIdx) => (
                <div key={sIdx} className="group">
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-sm font-semibold text-slate-200 group-hover:text-cyan-600 transition-colors">{skill.name}</span>
                    <span className="text-xs font-bold text-slate-400 bg-white/5 px-2 py-0.5 rounded">{skill.score}/100</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden mb-2">
                    <div 
                      className={`h-full rounded-full ${getScoreColor(skill.score)} transition-all duration-1000 shadow-[0_0_10px_rgba(0,0,0,0.3)]`} 
                      style={{ width: `${skill.score}%` }}
                    ></div>
                  </div>
                  <div className="flex items-start gap-2">
                     <svg className="w-3 h-3 text-slate-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                     <p className="text-[11px] text-slate-500 italic leading-tight">{skill.reasoning}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* AI Recommendations */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-950 rounded-2xl p-8 text-white shadow-xl border border-white/10 relative overflow-hidden">
         {/* Decorative bg elements */}
         <div className="absolute top-0 right-0 -mr-10 -mt-10 w-40 h-40 bg-white opacity-5 rounded-full blur-2xl"></div>
         <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-40 h-40 bg-teal-500 opacity-10 rounded-full blur-2xl"></div>

         <h3 className="text-xl font-bold mb-6 flex items-center gap-3 relative z-10">
           <div className="p-2 bg-white/10 rounded-lg">
              <svg className="w-6 h-6 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
           </div>
           Персональные рекомендации по развитию
         </h3>
         <div className="grid md:grid-cols-3 gap-6 relative z-10">
           {passport.recommendations.map((rec, idx) => (
             <div key={idx} className="bg-white/5 backdrop-blur-md p-5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
               <div className="text-3xl font-bold text-teal-500/20 mb-2 absolute top-2 right-4">0{idx + 1}</div>
               <p className="text-slate-200 text-sm leading-relaxed font-medium relative z-10">{rec}</p>
             </div>
           ))}
         </div>
      </div>
    </div>
  );
}
