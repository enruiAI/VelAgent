/**
 * embed 样式清理的共享实现：识别并移除会污染 DSH Harness 界面的全局规则。
 *
 * 由 clean-embed-css.mjs（构建后自动执行）与 verify-embed.mjs（产物验收）共用，
 * 两边必须用同一套判定，避免「清理了但验收标准不一致」。
 */

/** 整条规则命中即删除的全局 reset selector。 */
const RESET_SELECTORS = new Set([
  '*',
  '*::before',
  '*::after',
  '*::backdrop',
  'html',
  'body',
  '#root',
]);

/** 这些 at-rule 的 body 里可以继续嵌套普通规则，需要递归清理。 */
const AT_RULE_CONTAINERS = /^@(media|supports|container|layer|scope)\b/;

/** 画布挂载容器上的作用域属性，见 src/embed.tsx 的 mount()。 */
const EMBED_SCOPE = '[data-velxio-embed]';

/**
 * 按顶层规则切分 CSS，尊重注释与字符串里的花括号。
 * @param {string} css
 * @returns {{ text: string }[]}
 */
function splitChunks(css) {
  const chunks = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let inComment = false;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    const next = css[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        chunks.push({ text: css.slice(start, i + 1) });
        start = i + 1;
      }
      continue;
    }
    if (ch === ';' && depth === 0) {
      chunks.push({ text: css.slice(start, i + 1) });
      start = i + 1;
    }
  }
  const tail = css.slice(start);
  if (tail.trim()) chunks.push({ text: tail });
  return chunks;
}

/** 去掉注释并压缩空白，便于比较 selector。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 顶层逗号切分 selector（忽略 :is(...) / :not(...) 里的逗号）。 */
function splitSelectors(selector) {
  const parts = [];
  let current = '';
  let parens = 0;
  let quote = null;
  for (const ch of selector) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') parens += 1;
    if (ch === ')') parens -= 1;
    if (ch === ',' && parens === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** 提取规则前的注释，作用域化时原样保留。 */
function leadingComments(prelude) {
  const match = /^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/.exec(prelude);
  return match ? match[1] : '';
}

/** 把全局 `*:focus-visible` 一类规则收进画布容器。 */
function rescopeUniversal(part) {
  const rest = part.slice(1).trim();
  return rest ? `${EMBED_SCOPE} ${rest}` : EMBED_SCOPE;
}

/**
 * 清理一份 CSS：删除 *, html, body, #root 等全局 reset，把 `*:focus-visible`
 * 这类全局交互规则限定在画布容器内。
 * @param {string} css
 * @returns {{ css: string, removed: string[], scoped: string[], suspicious: string[] }}
 */
export function cleanCss(css) {
  const removed = [];
  const scoped = [];
  const suspicious = [];
  const out = [];
  for (const { text } of splitChunks(css)) {
    const braceIndex = text.indexOf('{');
    if (braceIndex < 0) {
      out.push(text);
      continue;
    }
    const prelude = text.slice(0, braceIndex);
    const body = text.slice(braceIndex + 1, text.lastIndexOf('}'));
    const selector = stripComments(prelude).trim();
    if (selector.startsWith('@')) {
      if (AT_RULE_CONTAINERS.test(selector)) {
        const inner = cleanCss(body);
        if (!inner.css.trim()) {
          removed.push(`${selector} { /* 内部全局规则已全部移除 */ }`);
          continue;
        }
        out.push(`\n${prelude}{${inner.css}}`);
        removed.push(...inner.removed);
        scoped.push(...inner.scoped);
        suspicious.push(...inner.suspicious);
        continue;
      }
      out.push(text);
      continue;
    }
    const parts = splitSelectors(selector);
    if (parts.length > 0 && parts.every((part) => RESET_SELECTORS.has(part))) {
      removed.push(selector.replace(/\s+/g, ' '));
      continue;
    }
    if (parts.length > 0 && parts.every((part) => part.startsWith('*'))) {
      const rescoped = parts.map(rescopeUniversal).join(', ');
      out.push(`\n${leadingComments(prelude)}${rescoped} {${body}}`);
      scoped.push(`${selector.replace(/\s+/g, ' ')} -> ${rescoped}`);
      continue;
    }
    for (const part of parts) {
      // 裸元素选择器（button、svg…）不会自动删除，只提示人工确认。
      if (/^[a-zA-Z][a-zA-Z0-9-]*(\b|$)/.test(part)) suspicious.push(selector.replace(/\s+/g, ' '));
    }
    out.push(text);
  }
  return { css: out.join(''), removed, scoped, suspicious };
}

/**
 * 验收用：返回 CSS 中仍存在的全局污染规则（全局 reset、需要作用域化的
 * 通用选择器、裸元素选择器）。空数组表示干净。
 * @param {string} css
 * @returns {string[]}
 */
export function findGlobalPollution(css) {
  const { removed, scoped, suspicious } = cleanCss(css);
  return [
    ...removed.map((item) => `全局 reset：${item}`),
    ...scoped.map((item) => `未作用域化的通用规则：${item}`),
    ...suspicious.map((item) => `裸元素选择器：${item}`),
  ];
}
