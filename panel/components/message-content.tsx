"use client";

// Dependency-free rich renderer for assistant messages.
// Deliberately no markdown library (keeps the panel offline-safe / supply-chain
// free, matching components/charts.tsx). Everything is rendered as React
// elements — text is escaped by React, so there is no HTML-injection surface.
//
// Supported: fenced code blocks (``` with optional language) + copy button,
// inline `code`, **bold**, [links](url), #/##/### headings, and - / * bullets.
// Anything else falls through as plain, wrapped text.

import { useState } from "react";

type Block = { type: "code"; lang: string; content: string } | { type: "text"; content: string };

function splitBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(src)) !== null) {
    if (m.index > last) blocks.push({ type: "text", content: src.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1].trim(), content: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < src.length) blocks.push({ type: "text", content: src.slice(last) });
  return blocks;
}

// Inline formatting → React nodes. Handles `code`, **bold**, [text](url).
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match, in priority order: inline code, bold, link.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) {
      nodes.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-700/70">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      nodes.push(<strong key={`${keyBase}-b${i}`} className="font-semibold">{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      const label = m[3].slice(1, m[3].indexOf("]"));
      nodes.push(
        <a key={`${keyBase}-l${i}`} href={m[4]} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2 hover:opacity-80">
          {label}
        </a>,
      );
    }
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function TextBlock({ content, keyBase }: { content: string; keyBase: string }) {
  // Render line-by-line so headings/bullets keep structure; blank lines = gaps.
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const key = `${keyBase}-${i}`;
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) {
          const size = h[1].length === 1 ? "text-base font-bold" : h[1].length === 2 ? "text-[0.95rem] font-semibold" : "text-sm font-semibold";
          return <p key={key} className={`${size} mt-1`}>{renderInline(h[2], key)}</p>;
        }
        const b = /^\s*[-*]\s+(.*)$/.exec(line);
        if (b) {
          return (
            <div key={key} className="flex gap-2">
              <span className="mt-[0.15em] text-brand">•</span>
              <span className="flex-1">{renderInline(b[1], key)}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={key} className="h-1.5" />;
        return <p key={key}>{renderInline(line, key)}</p>;
      })}
    </div>
  );
}

function CodeBlock({ lang, content }: { lang: string; content: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/80 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-slate-400">{lang || "kod"}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
        >
          {copied ? "✓ Kopyalandı" : "⧉ Kopyala"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className="font-mono">{content}</code>
      </pre>
    </div>
  );
}

export function MessageContent({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className="text-sm leading-relaxed">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} lang={b.lang} content={b.content} />
        ) : (
          <TextBlock key={i} content={b.content} keyBase={`t${i}`} />
        ),
      )}
    </div>
  );
}
