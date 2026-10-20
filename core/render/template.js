// Tiny template renderer (ADR-0002). Zero dependencies.
//
//   <%= path %>                       insert a value
//   <% if path %> … <% else %> … <% end %>
//   <% each path as name %> … <% end %>
//   <%%                               literal "<%"
//
// No expressions, filters or includes. A line holding only a block tag is removed.
// render(text, context, { file }) -> string; errors are TemplateError "<file>:<line>: <message>".

export class TemplateError extends Error {
  constructor(reason, { file, line } = {}) {
    super(`${file ?? '<template>'}:${line}: ${reason}`);
    this.name = 'TemplateError';
    this.reason = reason;
    this.file = file;
    this.line = line;
  }
}

const PATH = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/;
const NAME = /^[A-Za-z_][\w-]*$/;

export function render(text, context = {}, { file } = {}) {
  const tree = parse(tokenize(String(text), file), file);
  const out = [];
  emit(tree, [context], out, file);
  return out.join('');
}

// ---------------------------------------------------------------- tokenizer

// Tags never span lines, so the text is tokenized line by line.
const BLOCK_LINE = /^[ \t]*<%\s*(if|else|end|each)\b(?:[^%]|%(?!>))*%>[ \t]*\r?$/;

function tokenize(text, file) {
  const tokens = [];
  const lines = text.split(/(?<=\n)/);
  lines.forEach((full, index) => {
    const line = index + 1;
    const body = full.endsWith('\n') ? full.slice(0, -1) : full;
    if (BLOCK_LINE.test(body) && !body.includes('<%%')) {
      const open = body.indexOf('<%');
      tokens.push(tag(body.slice(open + 2, body.lastIndexOf('%>')), line, file));
      return;
    }
    let i = 0;
    let buf = '';
    while (i < full.length) {
      if (full.startsWith('<%%', i)) {
        buf += '<%';
        i += 3;
      } else if (full.startsWith('<%', i)) {
        const end = full.indexOf('%>', i + 2);
        if (end === -1) throw new TemplateError('unclosed tag "<%" (a tag must fit on one line)', { file, line });
        if (buf) tokens.push({ type: 'text', value: buf, line });
        buf = '';
        tokens.push(tag(full.slice(i + 2, end), line, file));
        i = end + 2;
      } else {
        buf += full[i++];
      }
    }
    if (buf) tokens.push({ type: 'text', value: buf, line });
  });
  return tokens;
}

function tag(raw, line, file) {
  if (raw.startsWith('=')) {
    const path = raw.slice(1).trim();
    if (!PATH.test(path)) throw new TemplateError(`invalid path "${path}"`, { file, line });
    return { type: 'value', path, line };
  }
  const words = raw.trim().split(/\s+/);
  const [kw] = words;
  if (kw === 'if' && words.length === 2 && PATH.test(words[1])) return { type: 'if', path: words[1], line };
  if (kw === 'else' && words.length === 1) return { type: 'else', line };
  if (kw === 'end' && words.length === 1) return { type: 'end', line };
  if (kw === 'each' && words.length === 4 && PATH.test(words[1]) && words[2] === 'as' && NAME.test(words[3])) {
    return { type: 'each', path: words[1], name: words[3], line };
  }
  throw new TemplateError(`unknown tag "<%${raw}%>"`, { file, line });
}

// ---------------------------------------------------------------- parser

function parse(tokens, file) {
  const root = { children: [] };
  const stack = [{ node: root, branch: root.children }];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'text' || t.type === 'value') {
      top.branch.push(t);
    } else if (t.type === 'if' || t.type === 'each') {
      const node = { ...t, then: [], else: [] };
      top.branch.push(node);
      stack.push({ node, branch: node.then });
    } else if (t.type === 'else') {
      if (top.node.type !== 'if' || top.branch === top.node.else) {
        throw new TemplateError('"else" without "if"', { file, line: t.line });
      }
      top.branch = top.node.else;
    } else if (t.type === 'end') {
      if (stack.length === 1) throw new TemplateError('"end" without "if" or "each"', { file, line: t.line });
      stack.pop();
    }
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1].node;
    throw new TemplateError(`"${open.type}" is not closed with "end"`, { file, line: open.line });
  }
  return root.children;
}

// ---------------------------------------------------------------- emitter

function lookup(path, scopes, file, line) {
  const [head, ...rest] = path.split('.');
  let value;
  let found = false;
  for (let s = scopes.length - 1; s >= 0; s--) {
    if (scopes[s] !== null && typeof scopes[s] === 'object' && Object.hasOwn(scopes[s], head)) {
      value = scopes[s][head];
      found = true;
      break;
    }
  }
  for (const key of rest) {
    if (!found || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      found = false;
      break;
    }
    value = value[key];
  }
  if (!found || value === undefined) throw new TemplateError(`missing value "${path}"`, { file, line });
  return value;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return v !== 0;
  if (v !== null && typeof v === 'object') return Object.keys(v).length > 0;
  return v === true;
}

function emit(nodes, scopes, out, file) {
  for (const n of nodes) {
    if (n.type === 'text') {
      out.push(n.value);
    } else if (n.type === 'value') {
      const v = lookup(n.path, scopes, file, n.line);
      if (v === null) continue;
      if (typeof v === 'object') throw new TemplateError(`"${n.path}" is not a scalar`, { file, line: n.line });
      out.push(String(v));
    } else if (n.type === 'if') {
      emit(truthy(lookup(n.path, scopes, file, n.line)) ? n.then : n.else, scopes, out, file);
    } else if (n.type === 'each') {
      const list = lookup(n.path, scopes, file, n.line);
      if (!Array.isArray(list)) throw new TemplateError(`"${n.path}" is not a list`, { file, line: n.line });
      for (const item of list) emit(n.then, [...scopes, { [n.name]: item }], out, file);
    }
  }
}
