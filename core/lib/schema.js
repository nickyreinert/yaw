// JSON Schema subset validator (ADR-0005). Zero dependencies.
//
// const set = new SchemaSet(); set.add('module.schema.json', schemaObject);
// set.validate('module.schema.json', data, { lines }) -> [{ pointer, line, message }]

export const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples']);

export const KEYWORDS = new Set([
  '$ref', '$defs',
  'type', 'enum', 'const',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'properties', 'required', 'additionalProperties', 'patternProperties',
  'allOf', 'anyOf', 'oneOf', 'not',
]);

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

export class SchemaSet {
  constructor() {
    this.schemas = new Map();
    this.regexps = new Map();
  }

  add(id, schema) {
    this.check(schema, `${id}#`);
    this.schemas.set(id, schema);
    return this;
  }

  // Resolve every $ref once; call after all schemas are added.
  checkRefs() {
    for (const [id, schema] of this.schemas) {
      walk(schema, (node, path) => {
        if (node && typeof node === 'object' && typeof node.$ref === 'string') {
          try {
            this.resolve(node.$ref, id);
          } catch (e) {
            throw new SchemaError(`${path}: ${e.message}`);
          }
        }
      }, `${id}#`);
    }
    return this;
  }

  check(schema, path) {
    if (typeof schema === 'boolean') return;
    if (!isObject(schema)) throw new SchemaError(`${path}: a schema must be an object or a boolean`);
    for (const [k, v] of Object.entries(schema)) {
      const at = `${path}/${k}`;
      if (ANNOTATIONS.has(k)) continue;
      if (!KEYWORDS.has(k)) throw new SchemaError(`${at}: unsupported keyword "${k}" (see ADR-0005)`);
      switch (k) {
        case 'type': {
          const list = Array.isArray(v) ? v : [v];
          if (list.length === 0 || list.some((t) => !TYPES.has(t))) throw new SchemaError(`${at}: invalid type`);
          break;
        }
        case 'enum':
          if (!Array.isArray(v) || v.length === 0) throw new SchemaError(`${at}: enum must be a non-empty array`);
          break;
        case 'minLength': case 'maxLength': case 'minItems': case 'maxItems':
          if (!Number.isInteger(v) || v < 0) throw new SchemaError(`${at}: must be a non-negative integer`);
          break;
        case 'minimum': case 'maximum':
          if (typeof v !== 'number') throw new SchemaError(`${at}: must be a number`);
          break;
        case 'uniqueItems':
          if (typeof v !== 'boolean') throw new SchemaError(`${at}: must be a boolean`);
          break;
        case 'pattern':
          this.regexp(v, at);
          break;
        case 'required':
          if (!Array.isArray(v) || v.some((r) => typeof r !== 'string')) throw new SchemaError(`${at}: must be an array of strings`);
          break;
        case '$ref':
          if (typeof v !== 'string') throw new SchemaError(`${at}: must be a string`);
          break;
        case 'properties': case '$defs':
          if (!isObject(v)) throw new SchemaError(`${at}: must be an object`);
          for (const [name, sub] of Object.entries(v)) this.check(sub, `${at}/${name}`);
          break;
        case 'patternProperties':
          if (!isObject(v)) throw new SchemaError(`${at}: must be an object`);
          for (const [re, sub] of Object.entries(v)) {
            this.regexp(re, at);
            this.check(sub, `${at}/${re}`);
          }
          break;
        case 'items': case 'additionalProperties': case 'not':
          this.check(v, at);
          break;
        case 'allOf': case 'anyOf': case 'oneOf':
          if (!Array.isArray(v) || v.length === 0) throw new SchemaError(`${at}: must be a non-empty array`);
          v.forEach((sub, i) => this.check(sub, `${at}/${i}`));
          break;
        default:
          break; // 'const' accepts any value
      }
    }
  }

  regexp(source, at) {
    if (typeof source !== 'string') throw new SchemaError(`${at}: pattern must be a string`);
    let re = this.regexps.get(source);
    if (!re) {
      try {
        re = new RegExp(source, 'u');
      } catch (e) {
        throw new SchemaError(`${at}: invalid pattern: ${e.message}`);
      }
      this.regexps.set(source, re);
    }
    return re;
  }

  resolve(ref, baseId) {
    const hash = ref.indexOf('#');
    const file = hash === -1 ? ref : ref.slice(0, hash);
    const fragment = hash === -1 ? '' : ref.slice(hash + 1);
    const id = file === '' ? baseId : file;
    let node = this.schemas.get(id);
    if (node === undefined) throw new SchemaError(`unknown schema "${id}" in $ref "${ref}"`);
    if (fragment !== '') {
      if (!fragment.startsWith('/')) throw new SchemaError(`only JSON-pointer fragments are supported in $ref "${ref}"`);
      for (const part of fragment.slice(1).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!isObject(node) || !Object.prototype.hasOwnProperty.call(node, key)) {
          throw new SchemaError(`$ref "${ref}" does not resolve`);
        }
        node = node[key];
      }
    }
    return { schema: node, id };
  }

  validate(id, data, { lines } = {}) {
    if (!this.schemas.has(id)) throw new SchemaError(`unknown schema "${id}"`);
    const errors = [];
    this.node(this.schemas.get(id), data, '', id, errors);
    return errors.map(({ pointer, message }) => ({ pointer, line: lineFor(lines, pointer), message }));
  }

  node(schema, data, ptr, base, errors) {
    if (schema === true) return;
    if (schema === false) {
      errors.push({ pointer: ptr, message: 'is not allowed' });
      return;
    }
    if (schema.$ref !== undefined) {
      const { schema: target, id } = this.resolve(schema.$ref, base);
      this.node(target, data, ptr, id, errors);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => hasType(data, t))) {
        errors.push({ pointer: ptr, message: `must be ${types.join(' or ')}`, typeMismatch: true });
        return;
      }
    }
    if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(e, data))) {
      errors.push({ pointer: ptr, message: `must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
    }
    if (schema.const !== undefined && !deepEqual(schema.const, data)) {
      errors.push({ pointer: ptr, message: `must be ${JSON.stringify(schema.const)}` });
    }
    if (typeof data === 'string') this.string(schema, data, ptr, errors);
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) errors.push({ pointer: ptr, message: `must be >= ${schema.minimum}` });
      if (schema.maximum !== undefined && data > schema.maximum) errors.push({ pointer: ptr, message: `must be <= ${schema.maximum}` });
    }
    if (Array.isArray(data)) this.array(schema, data, ptr, base, errors);
    if (isObject(data)) this.object(schema, data, ptr, base, errors);
    if (schema.allOf) for (const sub of schema.allOf) this.node(sub, data, ptr, base, errors);
    if (schema.anyOf || schema.oneOf) this.alternatives(schema, data, ptr, base, errors);
    if (schema.not !== undefined) {
      const sub = [];
      this.node(schema.not, data, ptr, base, sub);
      if (sub.length === 0) errors.push({ pointer: ptr, message: 'matches a form that is not allowed' });
    }
  }

  string(schema, data, ptr, errors) {
    const length = [...data].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push({ pointer: ptr, message: `must have at least ${schema.minLength} characters` });
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push({ pointer: ptr, message: `must have at most ${schema.maxLength} characters` });
    }
    if (schema.pattern !== undefined && !this.regexp(schema.pattern).test(data)) {
      errors.push({ pointer: ptr, message: `must match pattern ${schema.pattern}` });
    }
  }

  array(schema, data, ptr, base, errors) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ pointer: ptr, message: `must have at least ${schema.minItems} items` });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ pointer: ptr, message: `must have at most ${schema.maxItems} items` });
    }
    if (schema.uniqueItems) {
      const seen = new Map();
      data.forEach((item, i) => {
        const key = canonical(item);
        if (seen.has(key)) errors.push({ pointer: `${ptr}/${i}`, message: `duplicates item ${seen.get(key)}` });
        else seen.set(key, i);
      });
    }
    if (schema.items !== undefined) {
      data.forEach((item, i) => this.node(schema.items, item, `${ptr}/${i}`, base, errors));
    }
  }

  object(schema, data, ptr, base, errors) {
    for (const name of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(data, name)) {
        errors.push({ pointer: ptr, message: `missing required property "${name}"` });
      }
    }
    const props = schema.properties ?? {};
    const patterns = Object.entries(schema.patternProperties ?? {}).map(([re, sub]) => [this.regexp(re), sub]);
    for (const [key, value] of Object.entries(data)) {
      const at = `${ptr}/${escapePointer(key)}`;
      let matched = false;
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        matched = true;
        this.node(props[key], value, at, base, errors);
      }
      for (const [re, sub] of patterns) {
        if (re.test(key)) {
          matched = true;
          this.node(sub, value, at, base, errors);
        }
      }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push({ pointer: at, message: `unknown property "${key}"` });
        else this.node(schema.additionalProperties, value, at, base, errors);
      }
    }
  }

  alternatives(schema, data, ptr, base, errors) {
    const kind = schema.oneOf ? 'oneOf' : 'anyOf';
    const results = schema[kind].map((sub) => {
      const e = [];
      this.node(sub, data, ptr, base, e);
      return e;
    });
    const passing = results.filter((e) => e.length === 0).length;
    if (kind === 'oneOf' && passing > 1) {
      errors.push({ pointer: ptr, message: 'matches more than one allowed form' });
      return;
    }
    if (passing > 0) return;
    // Report one alternative when it is clearly the closest: drop alternatives that failed on their
    // type, then take the one with the fewest errors if it is unique. Otherwise report a summary.
    let candidates = results.filter((e) => !(e.length === 1 && e[0].typeMismatch && e[0].pointer === ptr));
    if (candidates.length > 1) {
      const fewest = Math.min(...candidates.map((e) => e.length));
      candidates = candidates.filter((e) => e.length === fewest);
    }
    if (candidates.length === 1) {
      errors.push(...candidates[0]);
      return;
    }
    const describe = (list) => list.map((e) => `${e.pointer.slice(ptr.length)}${e.pointer === ptr ? '' : ' '}${e.message}`).join(', ');
    errors.push({ pointer: ptr, message: `does not match any allowed form: ${results.map((e) => `[${describe(e)}]`).join(' or ')}` });
  }
}

export function formatError(error, file) {
  const where = error.line ? `${file}:${error.line}` : file;
  return `${where}: ${error.pointer || '/'} ${error.message}`;
}

function lineFor(lines, pointer) {
  if (!lines) return null;
  let p = pointer;
  for (;;) {
    if (lines.has(p)) return lines.get(p);
    if (p === '') return null;
    p = p.slice(0, p.lastIndexOf('/'));
  }
}

function hasType(v, t) {
  switch (t) {
    case 'object': return isObject(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function escapePointer(key) {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function deepEqual(a, b) {
  return canonical(a) === canonical(b);
}

function walk(node, fn, path) {
  fn(node, path);
  if (Array.isArray(node)) node.forEach((n, i) => walk(n, fn, `${path}/${i}`));
  else if (isObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'enum' || k === 'const' || k === 'default' || k === 'examples') continue;
      walk(v, fn, `${path}/${k}`);
    }
  }
}
