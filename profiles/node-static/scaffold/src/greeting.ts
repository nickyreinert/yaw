export function greeting(name: string | null): string {
  const who = name?.trim() ? name.trim() : 'world';
  return `Hello, ${who}!`;
}
