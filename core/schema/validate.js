#!/usr/bin/env node
// Validate YAW files against the schemas in this folder.
//
//   node core/schema/validate.js                  validate every example in core/schema/examples/
//   node core/schema/validate.js <schema> <file>  validate one file, e.g. "module module.yaml"
//
// Examples live in examples/<schema>/; the folder name selects <schema>.schema.json.
// .yaml is read with the strict YAML subset parser, .json with JSON.parse, .md with the TASKS.md parser.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SchemaSet, formatError } from '../lib/schema.js';
import { parseDocument } from '../lib/yaml.js';
import { parseTasksDocument } from '../lib/tasks.js';

export const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));
export const EXAMPLES_DIR = join(SCHEMA_DIR, 'examples');

export function loadSchemas(dir = SCHEMA_DIR) {
  const set = new SchemaSet();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.schema.json')).sort()) {
    set.add(f, JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  return set.checkRefs();
}

// Read a file into { value, lines }. Parse errors are thrown with file:line.
export function readData(file) {
  const text = readFileSync(file, 'utf8');
  const ext = extname(file);
  if (ext === '.yaml' || ext === '.yml') return parseDocument(text, { file });
  if (ext === '.md') return parseTasksDocument(text, { file });
  if (ext === '.json') return { value: JSON.parse(text), lines: null };
  throw new Error(`${file}: unsupported file type ${ext}`);
}

export function validateFile(set, schemaName, file) {
  const id = schemaName.endsWith('.schema.json') ? schemaName : `${schemaName}.schema.json`;
  const { value, lines } = readData(file);
  return set.validate(id, value, { lines }).map((e) => formatError(e, file));
}

export function listExamples(dir = EXAMPLES_DIR) {
  const out = [];
  for (const schema of readdirSync(dir).sort()) {
    for (const f of readdirSync(join(dir, schema)).sort()) out.push({ schema, file: join(dir, schema, f) });
  }
  return out;
}

function main(args) {
  const set = loadSchemas();
  const jobs = args.length === 0
    ? listExamples()
    : args.length === 2 ? [{ schema: args[0], file: args[1] }] : null;
  if (!jobs) {
    process.stderr.write('usage: validate.js [<schema> <file>]\n');
    return 2;
  }
  let failed = 0;
  for (const { schema, file } of jobs) {
    const shown = relative(process.cwd(), file) || basename(file);
    let errors;
    try {
      errors = validateFile(set, schema, file);
    } catch (e) {
      errors = [e.message];
    }
    if (errors.length === 0) {
      process.stdout.write(`ok    ${shown} (${schema})\n`);
    } else {
      failed++;
      process.stdout.write(`FAIL  ${shown} (${schema})\n`);
      for (const e of errors) process.stdout.write(`      ${e}\n`);
    }
  }
  process.stdout.write(`${jobs.length - failed}/${jobs.length} valid\n`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
