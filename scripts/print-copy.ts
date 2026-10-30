import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copy } from '../src/client/copy.js';

interface CopyRow {
  key: string;
  screen: string;
  text: string;
}

const rows: CopyRow[] = [];

function traverse(obj: unknown, prefix = '', topSection = ''): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    rows.push({
      key: prefix,
      screen: topSection,
      text: obj.replace(/\n/g, ' ').replace(/\|/g, '\\|'),
    });
    return;
  }

  if (typeof obj === 'function') {
    // If it's a template function, sample it
    let sample = '[dynamic function]';
    try {
      if (obj.length === 1) {
        sample = String((obj as (arg: string | number) => string)('example'));
      } else if (obj.length === 2) {
        sample = String((obj as (a: string, b: string) => string)('A', 'B'));
      }
    } catch {
      // Keep placeholder if invoking fails
    }
    rows.push({
      key: prefix,
      screen: topSection,
      text: sample.replace(/\n/g, ' ').replace(/\|/g, '\\|'),
    });
    return;
  }

  if (Array.isArray(obj)) {
    rows.push({
      key: prefix,
      screen: topSection,
      text: obj.join('; ').replace(/\|/g, '\\|'),
    });
    return;
  }

  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const nextKey = prefix ? `${prefix}.${k}` : k;
      const section = topSection || k;
      traverse(v, nextKey, section);
    }
  }
}

traverse(copy);

const docsDir = resolve('docs');
mkdirSync(docsDir, { recursive: true });

const mdLines = [
  '# Copy Review — Bunty Biryani Centre',
  '',
  'Every customer- and vendor-facing string in `src/client/copy.ts`.',
  '',
  '| Key | Section | Text |',
  '|---|---|---|',
  ...rows.map((r) => `| \`${r.key}\` | ${r.screen} | ${r.text} |`),
  '',
];

const outPath = resolve(docsDir, 'copy-review.md');
writeFileSync(outPath, mdLines.join('\n'), 'utf8');

console.log(`Printed ${rows.length} copy strings to ${outPath}`);
