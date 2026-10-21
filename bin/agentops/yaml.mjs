/**
 * Minimal YAML subset parser for AgentOps plan files.
 *
 * Supported:
 *   - mappings nested by indentation
 *   - sequences of scalars ("- item")
 *   - inline arrays: [a, b, "c d"]
 *   - single/double quoted strings, numbers, booleans, null
 *   - comments starting with # outside quotes
 *
 * Deliberately unsupported (fail loudly instead of guessing):
 *   - tabs for indentation, anchors/aliases, flow maps, multiline scalars (| and >),
 *     duplicate keys, sequence items that are mappings.
 *
 * The parser is intentionally small so contract validation is deterministic and auditable.
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = "YamlError";
    this.line = line ?? null;
  }
}

const BOOLEAN_TRUE = new Set(["true", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["false", "no", "off"]);

function tokenize(text) {
  const lines = [];
  const rawLines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  rawLines.forEach((raw, index) => {
    const lineNo = index + 1;
    const withoutComment = stripComment(raw, lineNo);
    if (withoutComment.trim() === "") return;
    const indentMatch = /^( *)/.exec(withoutComment);
    const indent = indentMatch[1].length;
    const content = withoutComment.slice(indent);
    if (content.startsWith("\t") || /^ *\t/.test(withoutComment)) {
      throw new YamlError("tab characters are not allowed for indentation", lineNo);
    }
    lines.push({ indent, content: content.trimEnd(), line: lineNo });
  });
  return lines;
}

function stripComment(line, lineNo) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  if (quote) throw new YamlError("unterminated quoted string", lineNo);
  return line;
}

function parseScalar(raw, lineNo) {
  const value = raw.trim();
  if (value === "") return null;
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new YamlError("unterminated inline array", lineNo);
    return splitInlineArray(value.slice(1, -1), lineNo).map((item) => parseScalar(item, lineNo));
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new YamlError("unterminated double-quoted string", lineNo);
    return value
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new YamlError("unterminated single-quoted string", lineNo);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "null" || value === "~") return null;
  const lowered = value.toLowerCase();
  if (BOOLEAN_TRUE.has(lowered)) return true;
  if (BOOLEAN_FALSE.has(lowered)) return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  if (value.startsWith("|") || value.startsWith(">")) {
    throw new YamlError("multiline scalars (| and >) are not supported; keep the value on one line", lineNo);
  }
  if (value.includes(": ") && !value.startsWith("http")) {
    // A mapping would have been tokenized as a key; a scalar containing ": " is almost always a mistake.
    throw new YamlError(`unexpected ": " inside a scalar: ${value.slice(0, 60)}`, lineNo);
  }
  return value;
}

function splitInlineArray(body, lineNo) {
  const parts = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') {
        current += body[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote) throw new YamlError("unterminated quoted string in inline array", lineNo);
  if (current.trim() !== "" || parts.length > 0) parts.push(current);
  return parts.map((part) => part.trim()).filter((part, index) => part !== "" || index < parts.length);
}

function parseBlock(lines, start, indent) {
  if (start >= lines.length) return [null, start];
  const first = lines[start];
  if (first.indent !== indent) throw new YamlError(`unexpected indentation (expected ${indent} spaces)`, first.line);

  if (first.content.startsWith("- ")) {
    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (line.indent !== indent) break;
      if (!line.content.startsWith("- ")) break;
      const itemText = line.content.slice(2).trim();
      if (itemText === "") throw new YamlError("sequence item must have a value", line.line);
      items.push(parseScalar(itemText, line.line));
      i += 1;
    }
    return [items, i];
  }

  const object = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent !== indent) break;
    if (line.content.startsWith("- ")) {
      throw new YamlError("cannot mix sequence items into a mapping block", line.line);
    }
    const match = /^([A-Za-z0-9_.-]+):(?:[ \t]*(.*))?$/.exec(line.content);
    if (!match) {
      throw new YamlError(`expected "key: value" (got: ${line.content.slice(0, 80)})`, line.line);
    }
    const key = match[1];
    if (Object.hasOwn(object, key)) throw new YamlError(`duplicate key: ${key}`, line.line);
    const rest = (match[2] ?? "").trim();
    if (rest !== "") {
      object[key] = parseScalar(rest, line.line);
      i += 1;
      continue;
    }
    const next = lines[i + 1];
    if (next && next.indent > indent) {
      const [value, nextIndex] = parseBlock(lines, i + 1, next.indent);
      object[key] = value;
      i = nextIndex;
    } else {
      object[key] = null;
      i += 1;
    }
  }
  return [object, i];
}

/** Parses a YAML document into a plain object of scalars, arrays and nested objects. */
export function parseYaml(text, { source = "yaml" } = {}) {
  const lines = tokenize(text);
  if (lines.length === 0) return {};
  if (lines[0].indent !== 0) throw new YamlError(`top-level content must start at column 0 (${source})`, lines[0].line);
  const [value, index] = parseBlock(lines, 0, 0);
  if (index < lines.length) {
    throw new YamlError(`unexpected content after document (${source})`, lines[index].line);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new YamlError(`document must be a mapping (${source})`, 1);
  }
  return value;
}

/** Splits a Markdown document with YAML frontmatter into meta and body. */
export function parseFrontmatter(markdown, { source = "markdown" } = {}) {
  const text = String(markdown ?? "").replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new YamlError(`missing YAML frontmatter delimited by --- in ${source}`);
  }
  const meta = parseYaml(match[1], { source: `${source} frontmatter` });
  return { meta, body: match[2] ?? "" };
}
