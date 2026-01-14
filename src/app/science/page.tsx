"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Atom,
  BookOpen,
  Cog,
  Cpu,
  FlaskConical,
  Leaf,
  Sparkles,
  Zap,
} from "lucide-react";
import campusData from "@/data/campusScience.json";

const SOURCE_SITE = "campusufa.ru";
const MAP_WIDTH = 1200;
const MAP_HEIGHT = 760;

type LabProgram = { university?: string; program: string };

type Lab = {
  id: number;
  url: string;
  name?: string;
  activity?: string | null;
  attributes?: Record<string, string | string[]>;
  researchTopics?: string[];
  educationalPrograms?: LabProgram[];
  networkPrograms?: string[];
  partners?: Record<string, string[]>;
  strategicProjects?: string[];
  supervisor?: string | null;
};

type Profile = {
  name: string;
  background: string;
  skills: string;
  goals: string;
  constraints: string;
};

type PathSegment = { x1: number; y1: number; x2: number; y2: number };

type ClusterColor = {
  node: string;
  badge: string;
  line: string;
  ring: string;
};

const colorSets: ClusterColor[] = [
  {
    node: "border-cyan-300/60 bg-cyan-400/15 text-cyan-50",
    badge: "text-cyan-200",
    line: "rgba(34, 211, 238, 0.65)",
    ring: "ring-cyan-300/40",
  },
  {
    node: "border-emerald-300/60 bg-emerald-400/15 text-emerald-50",
    badge: "text-emerald-200",
    line: "rgba(52, 211, 153, 0.65)",
    ring: "ring-emerald-300/40",
  },
  {
    node: "border-violet-300/60 bg-violet-400/15 text-violet-50",
    badge: "text-violet-200",
    line: "rgba(167, 139, 250, 0.65)",
    ring: "ring-violet-300/40",
  },
  {
    node: "border-amber-300/60 bg-amber-400/15 text-amber-50",
    badge: "text-amber-200",
    line: "rgba(251, 191, 36, 0.65)",
    ring: "ring-amber-300/40",
  },
  {
    node: "border-rose-300/60 bg-rose-400/15 text-rose-50",
    badge: "text-rose-200",
    line: "rgba(251, 113, 133, 0.65)",
    ring: "ring-rose-300/40",
  },
  {
    node: "border-sky-300/60 bg-sky-400/15 text-sky-50",
    badge: "text-sky-200",
    line: "rgba(56, 189, 248, 0.65)",
    ring: "ring-sky-300/40",
  },
  {
    node: "border-lime-300/60 bg-lime-400/15 text-lime-50",
    badge: "text-lime-200",
    line: "rgba(163, 230, 53, 0.65)",
    ring: "ring-lime-300/40",
  },
  {
    node: "border-orange-300/60 bg-orange-400/15 text-orange-50",
    badge: "text-orange-200",
    line: "rgba(251, 146, 60, 0.65)",
    ring: "ring-orange-300/40",
  },
];

const customOrbitAngles: Array<{ match: string; angle: number }> = [
  { match: "Без специализации", angle: 90 },
  { match: "Биомедицина и генетика", angle: 340 },
  { match: "Гуманитарные науки", angle: 210 },
  { match: "Другие направления", angle: 280 },
  { match: "Инжиниринг и передовые производственные", angle: 50 },
  { match: "Новая среда жизни", angle: 120 },
  { match: "Цифровая и зеленая химия", angle: 230 },
];

const data = campusData as unknown as {
  labs: Lab[];
};

const truncate = (text: string, limit: number) => {
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

const normalizeSpec = (value: string) => {
  const cleaned = value.replace(/[.\u2026]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return "Другие направления";
  return cleaned;
};

const normalizeActivity = (value?: string | null) => {
  if (!value) return "";
  let cleaned = value.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/(?:,?\s*(Университет|Специализация))+$/gi, "");
  cleaned = cleaned.replace(/[,\-–—:;]+$/g, "").trim();
  return cleaned;
};

const getTopicIcon = (topic: string) => {
  const text = topic.toLowerCase();
  if (/(био|генет|медиц|клин)/.test(text)) return Atom;
  if (/(хим|катализ|полимер|материал|реакц|нефт|газ)/.test(text)) return FlaskConical;
  if (/(энерг|энергет|атом|физик|квант)/.test(text)) return Zap;
  if (/(цифр|данн|ai|ии|программ|софт|кибер|информ)/.test(text)) return Cpu;
  if (/(эколог|климат|зелен|природ|устойчив)/.test(text)) return Leaf;
  if (/(инжинир|производ|констр|технол)/.test(text)) return Cog;
  if (/(гуманит|культур|истор|язык|социолог)/.test(text)) return BookOpen;
  return Sparkles;
};

export default function SciencePage() {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [hoveredTopic, setHoveredTopic] = useState<string | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [activeClusterIndex, setActiveClusterIndex] = useState(0);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [hasSelectedCluster, setHasSelectedCluster] = useState(false);
  const [selectedTopicOrigins, setSelectedTopicOrigins] = useState<Record<string, string>>({});
  const [pathSegments, setPathSegments] = useState<PathSegment[]>([]);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const sunRef = useRef<HTMLDivElement | null>(null);
  const moonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const planetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [profile, setProfile] = useState<Profile>({
    name: "",
    background: "",
    skills: "",
    goals: "",
    constraints: "",
  });
  const [generated, setGenerated] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const { labs } = useMemo(() => {
    const allLabs = data.labs || [];
    return {
      labs: allLabs.filter((lab) => lab.name),
    };
  }, []);

  const clusters = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        topics: Map<string, { count: number; labs: string[] }>;
        labs: Lab[];
      }
    >();

    labs.forEach((lab) => {
      const specValue = lab.attributes?.["Специализация"];
      const specs = Array.isArray(specValue)
        ? specValue
        : specValue
        ? [specValue]
        : ["Без специализации"];

      const activity = normalizeActivity(lab.activity);

      specs.forEach((spec) => {
        const name = normalizeSpec(spec);
        if (!map.has(name)) {
          map.set(name, { name, topics: new Map(), labs: [] });
        }
        const entry = map.get(name);
        if (!entry) return;
        entry.labs.push(lab);
        if (activity) {
          const meta = entry.topics.get(activity) || { count: 0, labs: [] };
          meta.count += 1;
          if (lab.name && meta.labs.length < 3 && !meta.labs.includes(lab.name)) {
            meta.labs.push(lab.name);
          }
          entry.topics.set(activity, meta);
        }
      });
    });

    const entries = Array.from(map.values())
      .map((entry) => ({
        name: entry.name,
        topics: Array.from(entry.topics.keys()).sort(),
        topicMeta: Object.fromEntries(entry.topics.entries()),
        labs: entry.labs,
      }))
      .filter((entry) => entry.topics.length)
      .sort((a, b) => (a.name > b.name ? 1 : -1));

    const count = entries.length || 1;
    const radius = 38;
    const angleStep = (2 * Math.PI) / count;

    return entries.map((entry, index) => {
      const angle = -Math.PI / 2 + angleStep * index;
      return {
        ...entry,
        color: colorSets[index % colorSets.length],
        position: {
          x: 50 + radius * Math.cos(angle),
          y: 50 + radius * Math.sin(angle),
        },
      };
    });
  }, [labs]);

  const safeIndex = clusters.length ? Math.min(activeClusterIndex, clusters.length - 1) : 0;
  const activeCluster = clusters[safeIndex] || null;

  const filterTopics = (topics: string[]) => {
    const q = topicSearch.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((topic) => topic.toLowerCase().includes(q));
  };

  const activeFilteredTopics = useMemo(() => {
    if (!activeCluster) return [];
    return filterTopics(activeCluster.topics);
  }, [activeCluster, topicSearch]);

  const activeVisibleTopics = useMemo(() => {
    if (!activeCluster) return [];
    return showAllTopics ? activeFilteredTopics : activeFilteredTopics.slice(0, 10);
  }, [activeFilteredTopics, showAllTopics, activeCluster]);

  const extraTopicsCount = Math.max(0, activeFilteredTopics.length - activeVisibleTopics.length);

  const getClusterVisibleTopics = (clusterName: string, isActive: boolean) => {
    const cluster = clusters.find((item) => item.name === clusterName);
    if (!cluster) return [];
    const filtered = filterTopics(cluster.topics);
    if (isActive) return activeVisibleTopics;
    return filtered.slice(0, 4);
  };

  const getMoonLayout = (seed: string, count: number) => {
    if (!count) return [];
    const layout: Array<{ angle: number; radius: number }> = [];
    const isEngineering = seed.startsWith("Инжиниринг и передовые");
    const baseAngle = (seed.length * 37) % 360;
    const baseRadius = 34 + (seed.length % 8) * 3 + (isEngineering ? 6 : 0);

    for (let i = 0; i < count; i += 1) {
      const angle =
        (baseAngle +
          (360 / count) * i +
          (seed.charCodeAt(i % seed.length) || 0) * (isEngineering ? 1.25 : 0.9) +
          (isEngineering ? 14 : 0)) %
        360;
      const radius =
        baseRadius + ((seed.charCodeAt((i + 3) % seed.length) || 0) % (isEngineering ? 32 : 24));
      layout.push({ angle, radius });
    }

    return layout;
  };

  const toggleTopic = (topic: string, clusterName?: string) => {
    setSelectedTopics((prev) => {
      if (prev.includes(topic)) {
        setSelectedTopicOrigins((prevMap) => {
          const next = { ...prevMap };
          delete next[topic];
          return next;
        });
        return prev.filter((t) => t !== topic);
      }
      setSelectedTopicOrigins((prevMap) => ({
        ...prevMap,
        [topic]: clusterName || prevMap[topic] || activeCluster?.name || "",
      }));
      return [...prev, topic];
    });
  };

  const activateCluster = (index: number) => {
    setShowAllTopics(false);
    if (hasSelectedCluster && activeClusterIndex === index) {
      setHasSelectedCluster(false);
      return;
    }
    setActiveClusterIndex(index);
    setHasSelectedCluster(true);
  };

  const selectedClusters = useMemo(() => {
    const set = new Set<string>();
    selectedTopics.forEach((topic) => {
      const cluster = selectedTopicOrigins[topic];
      if (cluster) set.add(cluster);
    });
    return set;
  }, [selectedTopics, selectedTopicOrigins]);

  const orbitRadiusByName = useMemo(() => {
    if (!clusters.length) return {};
    const fallbackMin = Math.min(MAP_WIDTH, MAP_HEIGHT);
    const viewportMin = Math.min(
      viewport.width || fallbackMin,
      viewport.height || fallbackMin
    );
    const maxOrbit = Math.min(560, Math.max(260, viewportMin * 0.47));
    const minOrbit = Math.min(180, maxOrbit * 0.45);
    const orbitGap =
      clusters.length > 1 ? (maxOrbit - minOrbit) / (clusters.length - 1) : 0;

    return clusters.reduce<Record<string, number>>((acc, cluster, index) => {
      acc[cluster.name] = minOrbit + orbitGap * index + index * 8;
      return acc;
    }, {});
  }, [clusters, viewport]);

  useEffect(() => {
    if (!selectedTopics.length || !mapRef.current || !sunRef.current) {
      setPathSegments([]);
      return;
    }

    const computePath = () => {
      if (!mapRef.current || !sunRef.current) return;
      const mapRect = mapRef.current.getBoundingClientRect();
      const sunRect = sunRef.current.getBoundingClientRect();
      const sunPoint = {
        x: sunRect.left + sunRect.width / 2 - mapRect.left,
        y: sunRect.top + sunRect.height / 2 - mapRect.top,
      };

      const points = selectedTopics
        .map((topic) => {
          const node = moonRefs.current[topic];
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const clusterName = selectedTopicOrigins[topic];
          const orbitRadius = clusterName ? orbitRadiusByName[clusterName] || 0 : 0;
          return {
            x: rect.left + rect.width / 2 - mapRect.left,
            y: rect.top + rect.height / 2 - mapRect.top,
            orbitRadius,
          };
        })
        .filter(Boolean) as Array<{ x: number; y: number; orbitRadius: number }>;

      if (!points.length) {
        setPathSegments([]);
        return;
      }

      points.sort((a, b) => b.orbitRadius - a.orbitRadius);
      const segments: PathSegment[] = [];
      for (let i = 0; i < points.length - 1; i += 1) {
        segments.push({
          x1: points[i].x,
          y1: points[i].y,
          x2: points[i + 1].x,
          y2: points[i + 1].y,
        });
      }
      setPathSegments(segments);

    };

    computePath();
    const interval = window.setInterval(computePath, 180);
    return () => window.clearInterval(interval);
  }, [selectedTopics, selectedTopicOrigins, orbitRadiusByName]);

  const handleProfileChange = (key: keyof Profile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const buildPrompt = () => {
    const topicsText = selectedTopics.length
      ? selectedTopics.join(", ")
      : "(темы не выбраны)";

    const profileText = [
      profile.name ? `Имя: ${profile.name}` : null,
      profile.background ? `Бэкграунд: ${profile.background}` : null,
      profile.skills ? `Навыки: ${profile.skills}` : null,
      profile.goals ? `Цели: ${profile.goals}` : null,
      profile.constraints ? `Ограничения: ${profile.constraints}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return `Сгенерируй новое междисциплинарное научное направление на основе выбранных тем.\n\nВыбранные темы: ${topicsText}.\n\nПрофиль пользователя:\n${profileText || "(профиль не заполнен)"}\n\nВажно: не добавляй приветствий, обращений по имени или фраз вроде "Привет, я Miraverse". Сразу дай ответ по структуре.\n\nФормат ответа:\n1) Название направления.\n2) Краткое описание (2-3 предложения).\n3) Ключевые научные вопросы и гипотезы.\n4) Сферы применения и потенциальный эффект.\n5) Необходимые компетенции и инфраструктура.\n6) Какие лаборатории кампуса ближе всего (по смыслу).\n7) Риски, этика и ограничения.\n8) Первые 3 шага для старта проекта.`;
  };

  const buildSources = () => {
    const selectedLabs = selectedTopics.length
      ? labs.filter((lab) => selectedTopics.includes(lab.activity?.trim() || ""))
      : activeCluster?.labs || [];

    const snippets = selectedLabs.length
      ? selectedLabs
      : (activeCluster?.labs || labs).slice(0, 6);

    const content = snippets
      .map((lab) => {
        const spec = lab.attributes?.["Специализация"] || "—";
        const activity = normalizeActivity(lab.activity) || "—";
        const topicsList = (lab.researchTopics || []).join("; ") || "—";
        return `Лаборатория: ${lab.name}\nСпециализация: ${Array.isArray(spec) ? spec.join(", ") : spec}\nНаправления деятельности: ${activity}\nТематики: ${topicsList}`;
      })
      .join("\n\n");

    return [
      {
        id: "campus-data",
        title: "Данные кампуса (лаборатории и направления деятельности)",
        type: "text" as const,
        content,
      },
    ];
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError("");
    setGenerated("");
    setShowResult(false);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          prompt: buildPrompt(),
          sources: buildSources(),
        }),
      });

      const payload = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Не удалось сгенерировать направление");
      }

      setGenerated(payload.text || "Ответ не получен");
      setShowResult(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка генерации";
      setError(message);
      setShowResult(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const isTopicActive = (topic: string) => selectedTopics.includes(topic) || hoveredTopic === topic;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070f]">
      <div className="absolute inset-0" ref={mapRef}>
        {!mounted ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-300">
            Загружаем карту…
          </div>
        ) : (
          <div className="absolute inset-0">
            <div className="absolute inset-0 galaxy-stars galaxy-stars-1" />
            <div className="absolute inset-0 galaxy-stars galaxy-stars-2" />
            <div className="absolute inset-0 galaxy-stars galaxy-stars-3" />
            <div className="absolute -left-20 top-10 h-64 w-64 rounded-full bg-gradient-to-br from-cyan-400/30 via-transparent to-transparent blur-3xl" />
            <div className="absolute right-10 top-20 h-72 w-72 rounded-full bg-gradient-to-br from-violet-400/30 via-transparent to-transparent blur-3xl" />
            <div className="absolute bottom-10 left-1/3 h-80 w-80 rounded-full bg-gradient-to-br from-emerald-400/20 via-transparent to-transparent blur-3xl" />

            <svg
              className="absolute inset-0 pointer-events-none"
              viewBox={`0 0 ${viewport.width || MAP_WIDTH} ${viewport.height || MAP_HEIGHT}`}
              preserveAspectRatio="none"
            >
              {pathSegments.map((segment, index) => (
                <line
                  key={`${segment.x1}-${segment.y1}-${segment.x2}-${segment.y2}-${index}`}
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  stroke="rgba(255, 255, 255, 0.35)"
                  strokeWidth="1.2"
                  strokeDasharray="6 8"
                  strokeLinecap="round"
                />
              ))}
            </svg>

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="sun" ref={sunRef}>
                <span className="sun-label">Miraverse</span>
                <span className="sun-glow" />
              </div>
            </div>

            {clusters.map((cluster, index) => {
              const fallbackMin = Math.min(MAP_WIDTH, MAP_HEIGHT);
              const viewportMin = Math.min(
                viewport.width || fallbackMin,
                viewport.height || fallbackMin
              );
              const maxOrbit = Math.min(560, Math.max(260, viewportMin * 0.47));
              const minOrbit = Math.min(180, maxOrbit * 0.45);
              const orbitGap =
                clusters.length > 1 ? (maxOrbit - minOrbit) / (clusters.length - 1) : 0;
              const orbitRadius = minOrbit + orbitGap * index + index * 8;
              const orbitSize = orbitRadius * 2;
              const orbitDuration = 420;
              const customAngle = customOrbitAngles.find((entry) =>
                cluster.name.startsWith(entry.match)
              )?.angle;
              const fallbackAngle = (360 / Math.max(1, clusters.length)) * index;
              const angleFromTop = customAngle ?? fallbackAngle;
              const cssAngle = angleFromTop - 90;
              const normalizedAngle = ((cssAngle % 360) + 360) % 360;
              const orbitDelay = -(orbitDuration * (normalizedAngle / 360));
              const isActive = index === safeIndex;
              const clusterTopics = getClusterVisibleTopics(cluster.name, isActive);
              const moonLayout = getMoonLayout(cluster.name, clusterTopics.length);

              return (
                <div key={cluster.name}>
                  <div
                    className="orbit-ring"
                    style={{
                      width: `${orbitSize}px`,
                      height: `${orbitSize}px`,
                      borderColor: cluster.color.line,
                      opacity: isActive ? 0.55 : 0.25,
                    }}
                  />

                  <div
                    className="orbit-rotate"
                    style={
                      {
                        animationDuration: `${orbitDuration}s`,
                        animationDelay: `${orbitDelay}s`,
                        ["--orbit-duration"]: `${orbitDuration}s`,
                        ["--orbit-delay"]: `${orbitDelay}s`,
                      } as CSSProperties
                    }
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={isActive}
                      ref={(node) => {
                        planetRefs.current[cluster.name] = node;
                      }}
                      onClick={() => {
                        activateCluster(index);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          activateCluster(index);
                        }
                      }}
                      className={`planet ${isActive ? "planet-active" : ""} ${
                        selectedClusters.has(cluster.name) ? "planet-selected" : ""
                      }`}
                      style={
                        {
                          transform: `translate(-50%, -50%) translateX(${orbitRadius}px)`,
                          ["--planet-color"]: cluster.color.line,
                        } as CSSProperties
                      }
                    >
                      <div className="planet-core-wrapper">
                        <div className="planet-core" />
                        <button
                          className="planet-label"
                          onClick={(event) => {
                            event.stopPropagation();
                            activateCluster(index);
                          }}
                        >
                          {truncate(cluster.name, 26)}
                        </button>
                        {clusterTopics.length ? (
                          <div
                            className="moon-orbit"
                            style={{
                              animationDuration: "160s",
                            }}
                          >
                            {clusterTopics.map((topic, moonIndex) => {
                              const layout = moonLayout[moonIndex] || {
                                angle: (360 / clusterTopics.length) * moonIndex,
                                radius: 42,
                              };
                              const active = isTopicActive(topic);
                              const Icon = getTopicIcon(topic);
                              return (
                                <button
                                  key={topic}
                                  ref={(node) => {
                                    moonRefs.current[topic] = node;
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleTopic(topic, cluster.name);
                                  }}
                                  onMouseEnter={() => setHoveredTopic(topic)}
                                  onMouseLeave={() => setHoveredTopic(null)}
                                  className={`moon group ${active ? "moon-active" : ""}`}
                                  style={
                                    {
                                      transform: `rotate(${layout.angle}deg) translateX(${layout.radius}px)`,
                                      ["--moon-angle"]: `${layout.angle}deg`,
                                    } as CSSProperties
                                  }
                                  aria-label={topic}
                                >
                                  <span className="moon-dot">
                                    <Icon className="moon-icon" aria-hidden />
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <header className="absolute left-6 right-6 top-6 z-30 flex flex-wrap items-center gap-4">
        <Link href="/" className="text-sm font-semibold text-slate-300 hover:text-white">
          {"←"} Назад
        </Link>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Miraverse</p>
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">Наука</h1>
          <p className="text-xs text-slate-300">
            Лабораторная вселенная для поиска будущих исследований.
          </p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          <input
            className="w-72 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white"
            placeholder="Поиск направления"
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
          />
          <button
            onClick={() => setShowProfile((prev) => !prev)}
            className="w-72 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-white/30"
          >
            Профиль исследователя
          </button>
        </div>
      </header>

      <section
        className={`absolute left-1/2 top-28 z-30 w-[min(860px,92vw)] -translate-x-1/2 transition-all duration-300 ${
          hasSelectedCluster && activeFilteredTopics.length
            ? "opacity-100 translate-y-0"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
      >
        {hasSelectedCluster && activeFilteredTopics.length ? (
          <div className="max-h-[65vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeFilteredTopics.map((topic) => {
                const isSelected = selectedTopics.includes(topic);
                const Icon = getTopicIcon(topic);
                return (
                  <button
                    key={topic}
                    onClick={() => toggleTopic(topic, activeCluster?.name)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      isSelected
                        ? "border-cyan-300/90 bg-cyan-300/80 text-white shadow-[0_18px_45px_rgba(34,211,238,0.28)]"
                        : "border-white/15 bg-[#0b1324]/80 text-slate-100 backdrop-blur-xl shadow-[0_12px_30px_rgba(5,7,15,0.45)] hover:border-white/35"
                    }`}
                  >
                    <Icon className="topic-icon" aria-hidden />
                    {topic}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {hasSelectedCluster && activeFilteredTopics.length ? (
          <div className="mt-4 flex justify-center">
            <button
              className="rounded-full border border-white/15 bg-[#0b1324]/80 px-5 py-2 text-xs text-slate-200 shadow-[0_10px_24px_rgba(5,7,15,0.45)] backdrop-blur-xl hover:border-white/35"
              onClick={() => setHasSelectedCluster(false)}
            >
              Закрыть
            </button>
          </div>
        ) : null}
      </section>

      <aside className="absolute left-6 top-28 z-30 w-64 rounded-3xl border border-white/15 bg-[#0b1324]/80 p-4 text-xs text-slate-100 shadow-[0_18px_40px_rgba(5,7,15,0.5)] backdrop-blur-xl">
        <p className="text-xs font-semibold text-slate-200">Специализации</p>
        <div className="mt-3 flex flex-col gap-2">
          {clusters.map((cluster, index) => {
            const isActive = index === safeIndex;
            return (
              <button
                key={cluster.name}
                onClick={() => {
                  activateCluster(index);
                }}
                className={`flex min-h-[44px] items-center justify-between rounded-2xl border px-3 py-2 text-left text-[11px] leading-snug transition ${
                  isActive
                    ? "border-cyan-300/70 bg-cyan-400/25 text-white shadow-[0_10px_24px_rgba(34,211,238,0.25)]"
                    : "border-white/15 bg-[#0b1324]/70 text-slate-200 hover:border-white/35"
                }`}
              >
                <span className="line-clamp-2">{cluster.name}</span>
                <span
                  className={`ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                    isActive ? "border-cyan-300/70 text-cyan-100" : "border-white/20 text-slate-300"
                  }`}
                >
                  {cluster.topics.length}
                </span>
              </button>
            );
          })}
        </div>

      </aside>

      <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200">
        <span>Направления: {activeFilteredTopics.length}</span>
        {extraTopicsCount > 0 ? (
          <button
            className="text-cyan-200 hover:text-cyan-100"
            onClick={() => setShowAllTopics((prev) => !prev)}
          >
            {showAllTopics ? "Свернуть" : `Показать ещё ${extraTopicsCount}`}
          </button>
        ) : null}
      </div>

      <div className="fixed bottom-6 right-6 z-40 w-[360px] max-w-[92vw] rounded-3xl border border-white/10 bg-[#0b1324]/90 p-5 text-xs text-slate-200 shadow-[0_0_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Сборка направления</h2>
          <span className="text-[10px] text-slate-400">Источник: {SOURCE_SITE}</span>
        </div>
        <p className="mt-2 text-[11px] text-slate-300">
          Выбрано тем: {selectedTopics.length}. Комбинируйте кластеры и получайте новое направление.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {selectedTopics.length ? (
            selectedTopics.map((topic) => (
              <button
                key={topic}
                onClick={() => toggleTopic(topic)}
                className="rounded-full border border-cyan-300/60 bg-cyan-400/10 px-3 py-1 text-[10px] text-white"
              >
                {(() => {
                  const Icon = getTopicIcon(topic);
                  return <Icon className="topic-icon" aria-hidden />;
                })()}
                {truncate(topic, 55)}
              </button>
            ))
          ) : (
            <span className="text-[11px] text-slate-400">Темы не выбраны</span>
          )}
        </div>

        <button
          onClick={handleGenerate}
          disabled={!selectedTopics.length || isGenerating}
          className="mt-4 w-full rounded-2xl bg-cyan-400/80 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-500/30 disabled:text-slate-300"
        >
          {isGenerating ? "Генерирую направление..." : "Найти новое направление"}
        </button>
      </div>

      {showResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/60 backdrop-blur-sm">
          <div className="h-[85vh] w-[min(1200px,96vw)] rounded-[32px] border border-white/10 bg-[#0b1324]/95 p-6 text-sm text-slate-200 shadow-[0_30px_80px_rgba(5,7,15,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Miraverse Наука</p>
                <h3 className="text-lg font-semibold text-white">Новое направление</h3>
              </div>
              <button
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:border-white/30"
                onClick={() => setShowResult(false)}
              >
                Закрыть
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {generated ? (
              <div className="markdown mt-4 h-[calc(85vh-120px)] overflow-y-auto text-[15px] leading-relaxed text-slate-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{generated}</ReactMarkdown>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={`fixed left-1/2 top-1/2 z-50 w-[min(620px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-[#0b1324]/95 p-5 text-xs text-slate-200 shadow-[0_30px_80px_rgba(5,7,15,0.55)] backdrop-blur-xl transition ${
          showProfile ? "opacity-100 scale-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Профиль исследователя</h2>
          <button
            onClick={() => setShowProfile(false)}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            Закрыть
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="flex flex-col gap-1">
            Имя
            <input
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white"
              value={profile.name}
              onChange={(e) => handleProfileChange("name", e.target.value)}
              placeholder="Как к вам обращаться"
            />
          </label>
          <label className="flex flex-col gap-1">
            Бэкграунд
            <textarea
              className="min-h-[80px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white"
              value={profile.background}
              onChange={(e) => handleProfileChange("background", e.target.value)}
              placeholder="Образование, опыт, текущая область"
            />
          </label>
          <label className="flex flex-col gap-1">
            Навыки и инструменты
            <textarea
              className="min-h-[80px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white"
              value={profile.skills}
              onChange={(e) => handleProfileChange("skills", e.target.value)}
              placeholder="Python, химия, клинические исследования, FPGA и т.д."
            />
          </label>
          <label className="flex flex-col gap-1">
            Цели
            <textarea
              className="min-h-[80px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white"
              value={profile.goals}
              onChange={(e) => handleProfileChange("goals", e.target.value)}
              placeholder="Что хотите получить от направления"
            />
          </label>
          <label className="flex flex-col gap-1">
            Ограничения
            <textarea
              className="min-h-[70px] rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white"
              value={profile.constraints}
              onChange={(e) => handleProfileChange("constraints", e.target.value)}
              placeholder="Бюджет, сроки, доступная инфраструктура"
            />
          </label>
        </div>
      </div>
    </main>
  );
}
