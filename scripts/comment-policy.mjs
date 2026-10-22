export function allowsComment(value) {
  const normalized = value.replace(/^\s*\* ?/gm, '').trim();
  return /^@(reason|compat|license)\s+\S[\s\S]*$/u.test(normalized);
}
