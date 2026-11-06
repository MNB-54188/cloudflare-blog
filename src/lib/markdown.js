// 轻量 Markdown 渲染器（零依赖，仅覆盖博客常用语法）
// 支持：代码块、标题、引用、有序/无序列表、表格、分隔线、粗体、斜体、删除线、行内代码、链接、图片

import { esc } from "./utils.js";

const SAFE_URL = /^(https?:\/\/|mailto:|\/|#|data:image\/)/i;

function safe(url) {
  return SAFE_URL.test(String(url || "").trim());
}

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) =>
    safe(src) ? `<img src="${src}" alt="${alt}" loading="lazy" />` : m
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) =>
    safe(href) ? `<a href="${href}" rel="noopener">${label}</a>` : m
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => codes[Number(n)] || "");
  return s;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function blocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 代码块
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束标记
      out.push(
        `<pre class="code-block"${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(
          buf.join("\n")
        )}</code></pre>`
      );
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // 标题（正文内最高级别为 h2，标题由页面模板输出 h1）
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${blocks(buf)}</blockquote>`);
      continue;
    }

    // 表格
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])
    ) {
      const splitRow = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    // 列表
    const first = line.match(LIST_RE);
    if (first) {
      const ordered = /^\d/.test(first[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        if (!m) {
          // 缩进续行并入上一项
          if (items.length && /^\s{2,}\S/.test(lines[i])) {
            items[items.length - 1] += " " + lines[i].trim();
            i++;
            continue;
          }
          break;
        }
        items.push(m[3]);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // 段落
    const buf = [];
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (
        /^```/.test(l) ||
        /^(#{1,6})\s+/.test(l) ||
        /^>\s?/.test(l) ||
        LIST_RE.test(l) ||
        /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)
      ) {
        break;
      }
      buf.push(l);
      i++;
    }
    if (buf.length) out.push(`<p>${buf.map(inline).join("<br />")}</p>`);
  }

  return out.join("\n");
}

/** 把 Markdown 源码渲染为 HTML 字符串 */
export function renderMarkdown(source) {
  const text = String(source ?? "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return '<p class="empty-hint">（正文为空）</p>';
  return blocks(text.split("\n"));
}
