// Answer values that were renamed stay readable: saved answers, presets and API calls written
// before the rename keep working and are read under the new value (T-002).
const RENAMED = { 'arch.language': { javascript: 'typescript' } };

// A single value of one question -> its current value.
export function currentValue(id, value) {
  return typeof value === 'string' && RENAMED[id]?.[value] ? RENAMED[id][value] : value;
}

// answers -> the same answers with renamed values replaced; the input is never changed.
export function migrateAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return answers;
  const out = { ...answers };
  for (const id of Object.keys(RENAMED)) if (Object.hasOwn(out, id)) out[id] = currentValue(id, out[id]);
  return out;
}
