import { Fragment, type ReactNode } from "react";

/**
 * A tiny, dependency-free Markdown renderer sized for agent chat output.
 * Handles headings, bold/italic, inline & fenced code, links, blockquotes,
 * horizontal rules, and ordered/unordered lists. Not CommonMark-complete —
 * just the subset LLMs actually emit — but safe: all text is escaped by React,
 * so no raw HTML is ever injected.
 */

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; text: string }
  | { t: "hr" }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] };

const HEAD = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```(\w*)\s*$/;
const UL = /^[-*+]\s+(.*)$/;
const OL = /^\d+[.)]\s+(.*)$/;
const HR = /^(?:---+|\*\*\*+|___+)\s*$/;

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buf.push(lines[i++]);
      i++; // consume closing fence
      blocks.push({ t: "code", lang, text: buf.join("\n") });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    const head = HEAD.exec(line);
    if (head) {
      blocks.push({ t: "h", level: head[1].length, text: head[2] });
      i++;
      continue;
    }

    if (UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL.test(lines[i])) items.push(UL.exec(lines[i++])![1]);
      blocks.push({ t: "ul", items });
      continue;
    }

    if (OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL.test(lines[i])) items.push(OL.exec(lines[i++])![1]);
      blocks.push({ t: "ol", items });
      continue;
    }

    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", text: buf.join("\n") });
      continue;
    }

    // paragraph: gather until blank line or a line that starts a new block
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEAD.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !lines[i].startsWith(">")
    ) {
      buf.push(lines[i++]);
    }
    blocks.push({ t: "p", text: buf.join("\n") });
  }

  return blocks;
}

// Inline: code spans first (so their contents aren't further parsed), then links,
// bold, italic. Returns an array of React nodes.
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) {
      out.push(
        <code key={key} className="mono rounded bg-surface2 px-1 py-0.5 text-[0.85em] text-fg">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      const lm = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(m[2])!;
      out.push(
        <a
          key={key}
          href={lm[2]}
          target="_blank"
          rel="noreferrer"
          className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
        >
          {lm[1]}
        </a>,
      );
    } else if (m[3]) {
      out.push(
        <strong key={key} className="font-semibold text-fg">
          {inline(m[3].slice(2, -2), key)}
        </strong>,
      );
    } else if (m[4]) {
      out.push(
        <em key={key} className="italic">
          {inline(m[4].slice(1, -1), key)}
        </em>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HSIZE = ["text-[20px]", "text-[18px]", "text-[16px]", "text-[15px]", "text-[14px]", "text-[13px]"];

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const size = HSIZE[b.level - 1] ?? HSIZE[5];
            return (
              <div key={i} className={`mb-1.5 mt-3 font-semibold text-fg first:mt-0 ${size}`}>
                {inline(b.text, `h${i}`)}
              </div>
            );
          }
          case "p":
            return (
              <p key={i} className="mb-2.5 whitespace-pre-wrap leading-relaxed last:mb-0">
                {inline(b.text, `p${i}`)}
              </p>
            );
          case "code":
            return (
              <pre
                key={i}
                className="scrollbar-thin mono mb-2.5 overflow-x-auto rounded-lg border border-line bg-surface2/60 p-3 text-[12px] leading-6"
              >
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={i} className="mb-2.5 border-l-2 border-brand/50 pl-3 text-muted italic">
                {b.text.split("\n").map((l, j) => (
                  <Fragment key={j}>
                    {inline(l, `q${i}-${j}`)}
                    <br />
                  </Fragment>
                ))}
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="my-4 border-line" />;
          case "ul":
            return (
              <ul key={i} className="mb-2.5 ml-1 list-disc space-y-1 pl-4 marker:text-faint">
                {b.items.map((it, j) => (
                  <li key={j} className="leading-relaxed">
                    {inline(it, `ul${i}-${j}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mb-2.5 ml-1 list-decimal space-y-1 pl-4 marker:text-faint">
                {b.items.map((it, j) => (
                  <li key={j} className="leading-relaxed">
                    {inline(it, `ol${i}-${j}`)}
                  </li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}
