import { NoSSR, withBase } from "@rspress/core/runtime";
import {
  Bell,
  Bot,
  Check,
  Command,
  Copy,
  FileCode,
  Palette,
  ShieldCheck,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import appIcon from "~/icon.png";

// the app's components need a browser, never rendered at build time
const HeroDemo = lazy(() => import("./HeroDemo"));

const DOWNLOAD_URL = "https://github.com/fkhadra/git-pal/releases/latest";
const GUIDE_URL = "/guide/installation";
const SHOWREEL_URL = "/showreel.mp4";
const SHOWREEL_POSTER_URL = "/showreel-poster.jpg";
const BREW_COMMAND = "brew install --cask fkhadra/tap/git-pal";
const COPIED_RESET_MS = 2000;

const FEATURES = [
  {
    icon: Command,
    color: "bg-blue-500/10 text-blue-500",
    title: "Command palette",
    description:
      "One shortcut away from any app. Search pull requests, repositories and code, filter by author with @.",
  },
  {
    icon: Bot,
    color: "bg-purple-500/10 text-purple-500",
    title: "AI code review",
    description:
      "Let Claude Code, Codex, Cursor, Antigravity or OpenCode review a pull request in the background.",
  },
  {
    icon: FileCode,
    color: "bg-orange-500/10 text-orange-500",
    title: "Review in context",
    description:
      "Comments land in the diff. Keep, edit or drop them, then submit to GitHub in one go.",
  },
  {
    icon: Bell,
    color: "bg-yellow-500/10 text-yellow-500",
    title: "Menu bar and Dock",
    description:
      "See agents working from the menu bar, and how many reviews wait on you from the Dock.",
  },
  {
    icon: Palette,
    color: "bg-pink-500/10 text-pink-500",
    title: "Make it yours",
    description:
      "Themes, keyboard shortcuts, review templates and the repositories Git Pal covers.",
  },
  {
    icon: ShieldCheck,
    color: "bg-green-500/10 text-green-500",
    title: "Private",
    description:
      "Your token stays in the system keychain, settings stay on your machine. No telemetry.",
  },
];

// iPads report "Macintosh" too, but have a touch screen
function isMac() {
  return (
    /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints === 0
  );
}

function BrewInstall() {
  const [copied, setCopied] = useState(false);

  if (!isMac()) return null;

  async function copy() {
    await navigator.clipboard.writeText(BREW_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 py-2 pr-2 pl-4 font-mono text-sm dark:border-zinc-800">
      <code>
        <span className="text-zinc-500 select-none">$ </span>
        {BREW_COMMAND}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy command"
        className="cursor-pointer rounded-md border-0 bg-transparent p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function Hero() {
  return (
    <section className="flex flex-col items-center gap-6 px-6 pt-20 text-center">
      <img src={appIcon} alt="" className="size-20" />
      <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-600 dark:text-yellow-400">
        ⚡ Active development
      </span>
      <h1 className="text-5xl font-semibold tracking-tight md:text-6xl">
        Git Pal
      </h1>
      <p className="max-w-xl text-lg text-zinc-500 dark:text-zinc-400">
        GitHub in your flow, not in your way. A keyboard-first companion for
        pull requests, with AI reviews built in.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <a
          href={DOWNLOAD_URL}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Download
        </a>
        <a
          href={withBase(GUIDE_URL)}
          className="rounded-lg border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Get started
        </a>
      </div>
      {/* the platform is only known in the browser */}
      <NoSSR>
        <BrewInstall />
      </NoSSR>
      <p className="text-sm text-zinc-500">macOS, Windows and Linux</p>
    </section>
  );
}

function Features() {
  return (
    <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map(({ icon: Icon, color, title, description }) => (
        <article
          key={title}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
        >
          <span className={`w-fit rounded-md p-2 ${color}`}>
            <Icon className="size-5" />
          </span>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
        </article>
      ))}
    </section>
  );
}

function Showreel() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6">
      <video
        src={withBase(SHOWREEL_URL)}
        poster={withBase(SHOWREEL_POSTER_URL)}
        controls
        playsInline
        preload="none"
        aria-label="Git Pal showreel"
        className="aspect-video w-full rounded-xl border border-zinc-200 bg-black dark:border-zinc-800"
      />
    </section>
  );
}

/** Landing page, the setup page's look and its live demo. */
export function Home() {
  return (
    <main className="flex flex-col gap-16">
      <Hero />
      {/* the demo's height, reserved before it loads */}
      <div className="min-h-[452px] px-6 lg:min-h-[588px]">
        <NoSSR>
          <Suspense>
            <HeroDemo />
          </Suspense>
        </NoSSR>
      </div>
      <Showreel />
      <Features />
    </main>
  );
}
