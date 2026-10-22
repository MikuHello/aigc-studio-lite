import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { allowsComment } from './comment-policy.mjs';

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesIn(path) : [path];
    }),
  );
  return nested.flat();
}

const paths = process.argv.slice(2);
const files = paths.length
  ? paths
  : ['index.html', ...(await filesIn('src')), ...(await filesIn('public'))];
let invalid = false;
for (const file of files.filter((path) => /\.(css|html)$/.test(path))) {
  const source = await readFile(file, 'utf8');
  const pattern =
    extname(file) === '.css'
      ? /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*([\s\S]*?)\*\//g
      : /<!--([\s\S]*?)-->/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] === undefined || allowsComment(match[1])) continue;
    const line = source.slice(0, match.index).split('\n').length;
    console.error(
      `${file}:${line}: Remove this comment or explain a necessary @reason, @compat or @license constraint.`,
    );
    invalid = true;
  }
}
if (invalid) process.exitCode = 1;
