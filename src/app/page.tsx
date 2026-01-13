import Link from "next/link";

const cards = [
  {
    title: "Miraverse Репетитор",
    description: "Персональный ИИ-репетитор для учебы, практики и подготовки.",
    href: "/tutor",
    accent: "from-cyan-400/20 via-sky-400/10 to-emerald-400/20",
  },
  {
    title: "Miraverse Наука",
    description: "Отдельное приложение для научных задач и экспериментов.",
    href: "/science",
    accent: "from-violet-400/20 via-fuchsia-400/10 to-pink-400/20",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-16 sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="space-y-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Miraverse</p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Выберите направление
          </h1>
          <p className="mx-auto max-w-2xl text-base text-slate-300">
            Два режима, два разных приложения. Выберите то, что нужно прямо сейчас.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-lg transition hover:-translate-y-1 hover:border-white/20"
            >
              <div
                className={`pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 bg-gradient-to-br ${card.accent}`}
              />
              <div className="relative flex h-full flex-col gap-6">
                <div className="space-y-3">
                  <h2 className="text-2xl font-semibold text-white sm:text-3xl">
                    {card.title}
                  </h2>
                  <p className="text-base text-slate-200">{card.description}</p>
                </div>
                <div className="mt-auto flex items-center gap-3 text-sm font-semibold text-white">
                  Перейти {"→"}
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 text-lg">
                    +
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
