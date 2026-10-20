// Strict YAML subset parser and emitter (ADR-0001). Zero dependencies.
//
// parse(text, { file })          -> value
// parseDocument(text, { file })  -> { value, lines }  (lines: Map<JSON pointer, 1-based line>)
// stringify(value, { header })   -> text

export const HEADER =
  '# Written by yaw. Comments are not preserved when yaw rewrites this file (yaw config set and similar commands).';

export class YamlError extends Error {
  constructor(reason, { file, line, column } = {}) {
    super(`${file ?? '<input>'}:${line}: ${reason}`);
    this.name = 'YamlError';
    this.reason = reason;
    this.file = file;
    this.line = line;
    this.column = column;
  }
}

export function parse(text, options = {}) {
  return parseDocument(text, options).value;
}

export function parseDocument(text, { file } = {}) {
  const parser = new Parser(String(text), file);
  const value = parser.parseRoot();
  return { value, lines: parser.pointers };
}

const SKIPPABLE = /^[ \t]*(#.*)?$/;

function escapePointer(key) {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

function setKey(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function isSeqEntry(content) {
  return content === '-' || content.startsWith('- ');
}

class Parser {
  constructor(text, file) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    this.lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] === '') this.lines.pop();
    this.file = file;
    this.i = 0;
    this.pointers = new Map();
  }

  fail(reason, lineIdx, col = 0) {
    throw new YamlError(reason, { file: this.file, line: lineIdx + 1, column: col + 1 });
  }

  indentOf(idx) {
    const line = this.lines[idx];
    let n = 0;
    while (line[n] === ' ') n++;
    if (line[n] === '\t') this.fail('tabs are not allowed in indentation', idx, n);
    return n;
  }

  // Advance this.i past blank and comment lines; check document-level markers.
  // Returns true when a content line is at this.i.
  skip() {
    while (this.i < this.lines.length && SKIPPABLE.test(this.lines[this.i])) this.i++;
    if (this.i >= this.lines.length) return false;
    const line = this.lines[this.i];
    if (/^(---|\.\.\.)([ \t]|$)/.test(line)) {
      this.fail('document markers (--- and ...) are not supported; use one document per file', this.i);
    }
    if (line[0] === '%') this.fail('directives (%) are not supported', this.i);
    return true;
  }

  parseRoot() {
    if (!this.skip()) return null;
    const indent = this.indentOf(this.i);
    this.pointers.set('', this.i + 1);
    const value = this.parseBlockNode(indent, -1, '');
    if (this.skip()) this.fail('unexpected content (check the indentation)', this.i, this.indentOf(this.i));
    return value;
  }

  // The line at this.i has indentation `indent`; parse the node starting there.
  parseBlockNode(indent, parentIndent, ptr) {
    const idx = this.i;
    const content = this.lines[idx].slice(indent);
    if (isSeqEntry(content)) return this.parseBlockSeq(indent, ptr);
    if (this.matchKey(content, idx, indent)) return this.parseBlockMap(indent, ptr);
    this.i = idx + 1;
    return this.parseInlineValue(content, indent, parentIndent, idx, ptr);
  }

  parseBlockMap(indent, ptr) {
    const obj = {};
    while (this.skip()) {
      const idx = this.i;
      const ind = this.indentOf(idx);
      if (ind < indent) break;
      if (ind > indent) this.fail('unexpected indentation', idx, ind);
      const content = this.lines[idx].slice(indent);
      if (isSeqEntry(content)) this.fail('expected "key: value", found a sequence entry', idx, ind);
      const m = this.matchKey(content, idx, indent);
      if (!m) this.fail('expected "key: value"', idx, ind);
      if (Object.prototype.hasOwnProperty.call(obj, m.key)) this.fail(`duplicate key "${m.key}"`, idx, ind);
      const childPtr = `${ptr}/${escapePointer(m.key)}`;
      this.pointers.set(childPtr, idx + 1);
      this.i = idx + 1;
      setKey(obj, m.key, this.parseMapValue(m.rest, m.restCol, indent, idx, childPtr));
    }
    return obj;
  }

  parseMapValue(rest, restCol, keyIndent, keyIdx, ptr) {
    let j = 0;
    while (rest[j] === ' ') j++;
    const v = rest.slice(j);
    const col = restCol + j;
    if (v === '' || v.startsWith('#')) {
      if (!this.skip()) return null;
      const nind = this.indentOf(this.i);
      const ncontent = this.lines[this.i].slice(nind);
      if (nind > keyIndent) return this.parseBlockNode(nind, keyIndent, ptr);
      if (nind === keyIndent && isSeqEntry(ncontent)) return this.parseBlockSeq(nind, ptr);
      return null;
    }
    if (isSeqEntry(v)) this.fail('a block sequence cannot start on the same line as its key', keyIdx, col);
    if (v[0] !== '[' && v[0] !== '{' && this.matchKey(v, keyIdx, col)) {
      this.fail('a mapping cannot start on the same line as its key; quote the value if it contains ": "', keyIdx, col);
    }
    return this.parseInlineValue(v, col, keyIndent, keyIdx, ptr);
  }

  parseBlockSeq(indent, ptr) {
    const arr = [];
    while (this.skip()) {
      const idx = this.i;
      const ind = this.indentOf(idx);
      if (ind < indent) break;
      if (ind > indent) this.fail('unexpected indentation', idx, ind);
      const content = this.lines[idx].slice(indent);
      if (!isSeqEntry(content)) break;
      const childPtr = `${ptr}/${arr.length}`;
      this.pointers.set(childPtr, idx + 1);
      let j = 1;
      while (content[j] === ' ') j++;
      const rest = content.slice(j);
      const col = indent + j;
      let value;
      if (rest === '' || rest.startsWith('#')) {
        this.i = idx + 1;
        value = this.skip() && this.indentOf(this.i) > indent
          ? this.parseBlockNode(this.indentOf(this.i), indent, childPtr)
          : null;
      } else if (isSeqEntry(rest) || (rest[0] !== '[' && rest[0] !== '{' && this.matchKey(rest, idx, col))) {
        // Compact nested node ("- key: v" or "- - x"): re-read the line with the dash blanked out.
        this.lines[idx] = ' '.repeat(col) + rest;
        this.i = idx;
        value = this.parseBlockNode(col, indent, childPtr);
      } else {
        this.i = idx + 1;
        value = this.parseInlineValue(rest, col, indent, idx, childPtr);
      }
      arr.push(value);
    }
    return arr;
  }

  // Returns { key, rest, restCol } when `content` starts with a mapping key, else null.
  matchKey(content, idx, col) {
    const c0 = content[0];
    if (c0 === '?' && (content.length === 1 || content[1] === ' ')) {
      this.fail('complex keys (?) are not supported', idx, col);
    }
    if (c0 === '"' || c0 === "'") {
      const { value, end } = this.scanQuoted(content, 0, idx, col);
      let j = end;
      while (content[j] === ' ') j++;
      if (content[j] === ':' && (j + 1 === content.length || content[j + 1] === ' ')) {
        return { key: value, rest: content.slice(j + 1), restCol: col + j + 1 };
      }
      return null;
    }
    if (c0 === '[' || c0 === '{') return null;
    for (let j = 0; j < content.length; j++) {
      const ch = content[j];
      if (ch === '#' && j > 0 && (content[j - 1] === ' ' || content[j - 1] === '\t')) return null;
      if (ch === ':' && (j + 1 === content.length || content[j + 1] === ' ')) {
        const key = content.slice(0, j).replace(/[ \t]+$/, '');
        if (key === '') this.fail('empty keys are not supported', idx, col);
        this.checkPlainStart(key, idx, col);
        if (key === '<<') this.fail('merge keys (<<) are not supported', idx, col);
        return { key, rest: content.slice(j + 1), restCol: col + j + 1 };
      }
    }
    return null;
  }

  checkPlainStart(text, idx, col) {
    const c = text[0];
    const next = text[1];
    if (c === '&') this.fail('anchors (&) are not supported', idx, col);
    if (c === '*') this.fail('aliases (*) are not supported', idx, col);
    if (c === '!') this.fail('tags (!) are not supported', idx, col);
    if (c === '|' || c === '>') this.fail(`"${c}" cannot start a key or a flow value`, idx, col);
    if (c === '%' || c === '@' || c === '`' || c === '#' || c === ',' || c === ']' || c === '}') {
      this.fail(`a plain value cannot start with "${c}"; quote it`, idx, col);
    }
    if ((c === '-' || c === '?' || c === ':') && (next === undefined || next === ' ')) {
      this.fail(`unexpected "${c}"`, idx, col);
    }
  }

  // Parse a scalar, flow collection or block scalar starting at column `col` of line `idx`.
  parseInlineValue(v, col, parentIndent, idx, ptr) {
    const c = v[0];
    if (c === '|' || c === '>') return this.parseBlockScalar(v, col, parentIndent, idx);
    if (c === '[' || c === '{') return this.parseFlow(idx, col, ptr);
    if (c === '"' || c === "'") {
      const { value, end } = this.scanQuoted(v, 0, idx, col);
      if (!/^([ \t]+#.*|[ \t]*)$/.test(v.slice(end))) this.fail('unexpected text after quoted string', idx, col + end);
      this.i = idx + 1;
      this.checkNoContinuation(parentIndent);
      return value;
    }
    const text = plainText(v);
    this.checkPlainStart(text, idx, col);
    if (/:( |$)/.test(text)) this.fail('unexpected ": " in a plain value; quote it', idx, col);
    this.i = idx + 1;
    this.checkNoContinuation(parentIndent);
    return this.resolvePlain(text, idx, col);
  }

  checkNoContinuation(parentIndent) {
    if (this.skip() && this.indentOf(this.i) > parentIndent) {
      this.fail('multi-line plain or quoted scalars are not supported; use | or >', this.i, this.indentOf(this.i));
    }
  }

  resolvePlain(text, idx, col) {
    const r = resolveScalar(text);
    if (r.error) this.fail(r.error, idx, col);
    return r.value;
  }

  scanQuoted(s, start, idx, col) {
    const q = s[start];
    let j = start + 1;
    let out = '';
    const unterminated = () =>
      this.fail('unterminated quoted string (multi-line quoted strings are not supported; use | or >)', idx, col + start);
    if (q === "'") {
      for (;;) {
        if (j >= s.length) unterminated();
        const ch = s[j];
        if (ch === "'") {
          if (s[j + 1] === "'") { out += "'"; j += 2; continue; }
          return { value: out, end: j + 1 };
        }
        out += ch;
        j++;
      }
    }
    for (;;) {
      if (j >= s.length) unterminated();
      const ch = s[j];
      if (ch === '"') return { value: out, end: j + 1 };
      if (ch === '\\') {
        const e = s[j + 1];
        if (e !== undefined && Object.prototype.hasOwnProperty.call(ESCAPES, e)) { out += ESCAPES[e]; j += 2; continue; }
        if (e === 'u') {
          const hex = s.slice(j + 2, j + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('invalid \\u escape (expected 4 hex digits)', idx, col + j);
          out += String.fromCharCode(parseInt(hex, 16));
          j += 6;
          continue;
        }
        this.fail(`unsupported escape "\\${e ?? ''}"`, idx, col + j);
      }
      out += ch;
      j++;
    }
  }

  parseBlockScalar(v, col, parentIndent, idx) {
    const style = v[0];
    let j = 1;
    let chomp = 'clip';
    if (v[j] === '-') { chomp = 'strip'; j++; } else if (v[j] === '+') { chomp = 'keep'; j++; }
    if (/[0-9]/.test(v[j] ?? '')) this.fail('block scalar indentation indicators are not supported', idx, col + j);
    if (!/^([ \t]+#.*|[ \t]*)$/.test(v.slice(j))) this.fail('unexpected text after block scalar indicator', idx, col + j);
    const raw = [];
    let contentIndent = -1;
    let k = idx + 1;
    for (; k < this.lines.length; k++) {
      const line = this.lines[k];
      if (/^[ \t]*$/.test(line)) { raw.push(''); continue; }
      let ind = 0;
      while (line[ind] === ' ') ind++;
      if (contentIndent < 0) {
        if (ind <= parentIndent) break;
        if (line[ind] === '\t') this.fail('tabs are not allowed in indentation', k, ind);
        contentIndent = ind;
      }
      if (ind < contentIndent) {
        if (ind > parentIndent) this.fail('inconsistent indentation in block scalar', k, ind);
        break;
      }
      raw.push(line.slice(contentIndent));
    }
    this.i = k;
    let end = raw.length;
    while (end > 0 && raw[end - 1] === '') end--;
    const body = raw.slice(0, end);
    const trailing = raw.length - end;
    let text = style === '|' ? body.join('\n') : fold(body);
    if (chomp === 'clip' && body.length > 0) text += '\n';
    if (chomp === 'keep') text += (body.length > 0 ? '\n' : '') + '\n'.repeat(trailing);
    return text;
  }

  parseFlow(idx, col, ptr) {
    const fp = { li: idx, pos: col, start: idx };
    const value = this.flowNode(fp, ptr);
    const rest = this.lines[fp.li].slice(fp.pos);
    if (!/^([ \t]+#.*|[ \t]*)$/.test(rest)) this.fail('unexpected text after flow collection', fp.li, fp.pos);
    this.i = fp.li + 1;
    return value;
  }

  flowSkip(fp) {
    for (;;) {
      const line = this.lines[fp.li];
      while (fp.pos < line.length && (line[fp.pos] === ' ' || line[fp.pos] === '\t')) fp.pos++;
      const atComment = line[fp.pos] === '#' && (fp.pos === 0 || line[fp.pos - 1] === ' ' || line[fp.pos - 1] === '\t');
      if (fp.pos < line.length && !atComment) return;
      fp.li++;
      fp.pos = 0;
      if (fp.li >= this.lines.length) this.fail('unterminated flow collection', fp.start);
    }
  }

  flowNode(fp, ptr) {
    this.flowSkip(fp);
    const line = this.lines[fp.li];
    const c = line[fp.pos];
    if (c === '[') return this.flowSeq(fp, ptr);
    if (c === '{') return this.flowMap(fp, ptr);
    if (c === '"' || c === "'") {
      const { value, end } = this.scanQuoted(line, fp.pos, fp.li, 0);
      fp.pos = end;
      return value;
    }
    const text = this.flowPlain(fp);
    if (text === '') this.fail('expected a value', fp.li, fp.pos);
    return this.resolvePlain(text, fp.li, fp.pos);
  }

  flowPlain(fp) {
    const line = this.lines[fp.li];
    const start = fp.pos;
    let j = start;
    while (j < line.length) {
      const c = line[j];
      if (',[]{}'.includes(c)) break;
      if (c === ':' && (j + 1 >= line.length || ' \t,]}'.includes(line[j + 1]))) break;
      if (c === '#' && j > start && (line[j - 1] === ' ' || line[j - 1] === '\t')) break;
      j++;
    }
    const text = line.slice(start, j).replace(/[ \t]+$/, '');
    if (text !== '') this.checkPlainStart(text, fp.li, start);
    fp.pos = j;
    return text;
  }

  flowSeq(fp, ptr) {
    fp.pos++;
    const arr = [];
    for (;;) {
      this.flowSkip(fp);
      if (this.lines[fp.li][fp.pos] === ']') { fp.pos++; return arr; }
      const childPtr = `${ptr}/${arr.length}`;
      this.pointers.set(childPtr, fp.li + 1);
      arr.push(this.flowNode(fp, childPtr));
      this.flowSkip(fp);
      const c = this.lines[fp.li][fp.pos];
      if (c === ':') this.fail('mappings inside flow sequences need braces: [{ key: value }]', fp.li, fp.pos);
      if (c === ',') { fp.pos++; continue; }
      if (c === ']') { fp.pos++; return arr; }
      this.fail('expected "," or "]"', fp.li, fp.pos);
    }
  }

  flowMap(fp, ptr) {
    fp.pos++;
    const obj = {};
    for (;;) {
      this.flowSkip(fp);
      let line = this.lines[fp.li];
      if (line[fp.pos] === '}') { fp.pos++; return obj; }
      const keyLine = fp.li;
      const keyCol = fp.pos;
      let key;
      const c = line[fp.pos];
      if (c === '"' || c === "'") {
        const { value, end } = this.scanQuoted(line, fp.pos, fp.li, 0);
        key = value;
        fp.pos = end;
      } else if (c === '[' || c === '{') {
        this.fail('flow collections as keys are not supported', fp.li, fp.pos);
      } else {
        key = this.flowPlain(fp);
        if (key === '') this.fail('expected a key', fp.li, fp.pos);
        if (key === '<<') this.fail('merge keys (<<) are not supported', keyLine, keyCol);
      }
      this.flowSkip(fp);
      line = this.lines[fp.li];
      if (line[fp.pos] !== ':') this.fail('expected ":" after key in flow mapping', fp.li, fp.pos);
      fp.pos++;
      if (Object.prototype.hasOwnProperty.call(obj, key)) this.fail(`duplicate key "${key}"`, keyLine, keyCol);
      const childPtr = `${ptr}/${escapePointer(key)}`;
      this.pointers.set(childPtr, keyLine + 1);
      this.flowSkip(fp);
      line = this.lines[fp.li];
      const value = line[fp.pos] === ',' || line[fp.pos] === '}' ? null : this.flowNode(fp, childPtr);
      setKey(obj, key, value);
      this.flowSkip(fp);
      const d = this.lines[fp.li][fp.pos];
      if (d === ',') { fp.pos++; continue; }
      if (d === '}') { fp.pos++; return obj; }
      this.fail('expected "," or "}"', fp.li, fp.pos);
    }
  }
}

const ESCAPES = { '\\': '\\', '"': '"', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', 0: '\0' };

function plainText(v) {
  const m = /[ \t]#/.exec(v);
  return (m ? v.slice(0, m.index) : v).replace(/[ \t]+$/, '');
}

function fold(lines) {
  let out = '';
  let i = 0;
  while (i < lines.length && lines[i] === '') { out += '\n'; i++; }
  if (i === lines.length) return out;
  const isMore = (l) => l[0] === ' ' || l[0] === '\t';
  out += lines[i];
  let prevMore = isMore(lines[i]);
  let empties = 0;
  for (i++; i < lines.length; i++) {
    const l = lines[i];
    if (l === '') { empties++; continue; }
    const more = isMore(l);
    out += !prevMore && !more ? (empties ? '\n'.repeat(empties) : ' ') : '\n'.repeat(empties + 1);
    out += l;
    prevMore = more;
    empties = 0;
  }
  return out;
}

// YAML 1.2 core schema resolution for plain scalars. Returns { value } or { error }.
export function resolveScalar(text) {
  if (text === '' || /^(null|Null|NULL|~)$/.test(text)) return { value: null };
  if (/^(true|True|TRUE)$/.test(text)) return { value: true };
  if (/^(false|False|FALSE)$/.test(text)) return { value: false };
  let n;
  if (/^[-+]?[0-9]+$/.test(text)) n = Number(text);
  else if (/^0o[0-7]+$/.test(text)) n = parseInt(text.slice(2), 8);
  else if (/^0x[0-9a-fA-F]+$/.test(text)) n = parseInt(text.slice(2), 16);
  if (n !== undefined) {
    if (!Number.isSafeInteger(n)) return { error: 'integer is out of the safe range; quote it' };
    return { value: n === 0 ? 0 : n };
  }
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)) {
    n = Number(text);
    if (!Number.isFinite(n)) return { error: 'number is out of range' };
    return { value: n === 0 ? 0 : n };
  }
  if (/^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/.test(text)) return { error: '.inf and .nan are not supported' };
  return { value: text };
}

// ---------------------------------------------------------------- emitter

export function stringify(value, { header = true } = {}) {
  const out = header ? [HEADER] : [];
  emitRoot(value, out);
  return out.join('\n') + '\n';
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function entries(obj) {
  return Object.entries(obj).filter(([, v]) => v !== undefined);
}

function emitRoot(value, out) {
  if (isPlainObject(value) && entries(value).length > 0) return emitMap(value, 0, out);
  if (Array.isArray(value) && value.length > 0) return emitSeq(value, 0, out);
  if (isLiteralString(value)) return emitLiteral('', value, 0, out);
  out.push(scalar(value));
}

function emitMap(obj, indent, out) {
  const pad = ' '.repeat(indent);
  for (const [k, v] of entries(obj)) {
    const key = formatKey(k);
    if (isPlainObject(v) && entries(v).length > 0) {
      out.push(`${pad}${key}:`);
      emitMap(v, indent + 2, out);
    } else if (Array.isArray(v) && v.length > 0) {
      out.push(`${pad}${key}:`);
      emitSeq(v, indent + 2, out);
    } else if (isLiteralString(v)) {
      emitLiteral(`${pad}${key}: `, v, indent, out);
    } else {
      out.push(`${pad}${key}: ${scalar(v)}`);
    }
  }
}

function emitSeq(arr, indent, out) {
  const pad = ' '.repeat(indent);
  for (const item of arr) {
    if ((isPlainObject(item) && entries(item).length > 0) || (Array.isArray(item) && item.length > 0)) {
      const sub = [];
      if (Array.isArray(item)) emitSeq(item, indent + 2, sub);
      else emitMap(item, indent + 2, sub);
      sub[0] = `${pad}- ${sub[0].slice(indent + 2)}`;
      out.push(...sub);
    } else if (isLiteralString(item)) {
      emitLiteral(`${pad}- `, item, indent, out);
    } else {
      out.push(`${pad}- ${scalar(item === undefined ? null : item)}`);
    }
  }
}

function isLiteralString(s) {
  if (typeof s !== 'string' || !s.includes('\n') || !/\S/.test(s)) return false;
  if (/[\x00-\x08\x0b-\x1f\x7f\ufeff]/.test(s) || /[\ud800-\udfff]/.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) return false;
  const lines = s.replace(/\n+$/, '').split('\n');
  if (lines.some((l) => l !== '' && /^[ \t]*$/.test(l))) return false;
  const first = lines.find((l) => l !== '');
  return !/^[ \t]/.test(first);
}

function emitLiteral(prefix, s, indent, out) {
  const trailing = s.length - s.replace(/\n+$/, '').length;
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+';
  out.push(`${prefix}|${chomp}`);
  const pad = ' '.repeat(indent + 2);
  for (const l of s.replace(/\n+$/, '').split('\n')) out.push(l === '' ? '' : pad + l);
  for (let k = 1; k < trailing; k++) out.push('');
}

function formatKey(k) {
  return /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(k) ? k : doubleQuote(k);
}

function scalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('cannot write a non-finite number as YAML');
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) return v.toExponential();
    return String(v);
  }
  if (typeof v === 'string') return isPlainSafe(v) ? v : doubleQuote(v);
  if (Array.isArray(v)) return '[]';
  if (isPlainObject(v)) return '{}';
  throw new TypeError(`cannot write a value of type ${typeof v} as YAML`);
}

function isPlainSafe(s) {
  if (s === '' || /^[ \t]|[ \t]$/.test(s)) return false;
  if (/[\x00-\x1f\x7f\ufeff\u0085\u2028\u2029]/.test(s) || /[\ud800-\udfff]/.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || s.startsWith('...')) return false;
  if (/: |:$| #/.test(s)) return false;
  const r = resolveScalar(s);
  return !r.error && r.value === s;
}

function doubleQuote(s) {
  let o = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') o += '\\"';
    else if (ch === '\\') o += '\\\\';
    else if (ch === '\n') o += '\\n';
    else if (ch === '\t') o += '\\t';
    else if (ch === '\r') o += '\\r';
    else if (ch === '\b') o += '\\b';
    else if (ch === '\f') o += '\\f';
    else if (c < 0x20 || c === 0x7f || (c >= 0xd800 && c <= 0xdfff) || c === 0xfeff) o += `\\u${c.toString(16).padStart(4, '0')}`;
    else o += ch;
  }
  return `${o}"`;
}
