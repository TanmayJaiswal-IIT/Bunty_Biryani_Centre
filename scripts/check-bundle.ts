import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 130;
const BUDGET_BYTES = BUDGET_KB * 1024;
const MANIFEST_PATH = resolve('dist/client/.vite/manifest.json');

if (!existsSync(MANIFEST_PATH)) {
  console.error(`Manifest not found at ${MANIFEST_PATH}. Run 'pnpm build:client' first.`);
  process.exit(1);
}

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, ManifestChunk>;

// Find entry point
const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
if (!entryKey || !manifest[entryKey]) {
  console.error('No entry chunk found in manifest.');
  process.exit(1);
}

const collectedKeys = new Set<string>();

function collectStaticImports(key: string) {
  if (collectedKeys.has(key)) return;
  collectedKeys.add(key);
  const chunk = manifest[key];
  if (chunk?.imports) {
    for (const imp of chunk.imports) {
      collectStaticImports(imp);
    }
  }
}

collectStaticImports(entryKey);

console.log('\n--- Client Entry Bundle Analysis ---');
console.log('Target budget: <= %d KB gzipped\n', BUDGET_KB);

let totalRaw = 0;
let totalGzip = 0;
let hasAdminLeak = false;

const rows: Array<{ file: string; raw: string; gzip: string }> = [];

for (const key of collectedKeys) {
  const chunk = manifest[key];
  if (!chunk) continue;
  const filePath = resolve('dist/client', chunk.file);
  if (!existsSync(filePath)) {
    console.error(`Chunk file missing: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSync(filePath);
  // Verify no admin code in static entry bundle via sourcemap and manifest src
  if (chunk.src?.includes('features/admin')) {
    console.error(`FAIL: Admin entry detected in static bundle chunk: ${chunk.file}`);
    hasAdminLeak = true;
  }

  const mapPath = `${filePath}.map`;
  if (existsSync(mapPath)) {
    try {
      const sourcemap = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources?: string[] };
      const adminSources = (sourcemap.sources ?? []).filter(
        (src: string) => src.includes('features/admin') || src.includes('features\\admin'),
      );
      if (adminSources.length > 0) {
        console.error(
          `FAIL: Admin code detected in sourcemap for ${chunk.file}:`,
          adminSources,
        );
        hasAdminLeak = true;
      }
    } catch {
      // Sourcemap parse error
    }
  }

  const rawSize = content.length;
  const gzipSize = gzipSync(content).length;

  totalRaw += rawSize;
  totalGzip += gzipSize;

  rows.push({
    file: chunk.file,
    raw: (rawSize / 1024).toFixed(2) + ' KB',
    gzip: (gzipSize / 1024).toFixed(2) + ' KB',
  });
}

console.table(rows);
const totalGzipKB = totalGzip / 1024;
console.log('Total raw size:     %s KB', (totalRaw / 1024).toFixed(2));
console.log('Total gzipped size: %s KB', totalGzipKB.toFixed(2));

if (hasAdminLeak) {
  console.error('\nFAIL: Admin code leaked into public entry bundle.\n');
  process.exit(1);
}

if (totalGzip > BUDGET_BYTES) {
  console.error(
    `\nFAIL: Entry bundle exceeds budget! ${totalGzipKB.toFixed(2)} KB > ${BUDGET_KB} KB\n`,
  );
  process.exit(1);
}

console.log(
  `\nPASS: Entry bundle is within ${BUDGET_KB} KB budget (${totalGzipKB.toFixed(2)} KB gzipped).\n`,
);
