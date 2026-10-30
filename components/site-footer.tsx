"use client";

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  return () => observer.disconnect();
};
const currentStyle = () => document.documentElement.dataset.style ?? "a";

/** Switches between the two visual treatments for design review (A/B test, work item F14). */
export function StyleSwitcher() {
  const style = useSyncExternalStore(subscribe, currentStyle, () => "a");
  const choose = (next: "a" | "b") => {
    document.documentElement.setAttribute("data-style", next);
    try {
      localStorage.setItem("readystate-style", next);
    } catch {}
  };
  return (
    <div role="group" aria-label="Visual style" className="inline-flex rounded-control border border-line-strong p-0.5">
      {(["a", "b"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={style === option}
          onClick={() => choose(option)}
          className={`rounded-control px-2.5 py-1 text-xs font-semibold ${
            style === option ? "bg-action text-on-action" : "text-ink-2 hover:text-ink"
          }`}
        >
          {option === "a" ? "Style A: Journal" : "Style B: Modern"}
        </button>
      ))}
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
        <p>
          ReadyState is practice, not professional emergency or medical advice. In an emergency, call 911.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {/* AGPL-3.0 §13: users of the service can get the source (work item S5). */}
          <a href="https://github.com/tescolopio/ReadyState" className="underline underline-offset-2 hover:text-ink">
            Source code (AGPL-3.0)
          </a>
          <StyleSwitcher />
        </div>
      </div>
    </footer>
  );
}
