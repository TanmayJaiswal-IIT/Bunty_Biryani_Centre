import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface CheckResult {
  step: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

const results: CheckResult[] = [];

function record(step: string, name: string, status: 'PASS' | 'FAIL' | 'WARN', details: string) {
  results.push({ step, name, status, details });
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '⚠' : '✗';
  console.log(`  [${icon}] ${step}: ${name} — ${details}`);
}

async function runSmokeTest() {
  const targetArg = process.argv[2] || process.env.APP_ORIGIN || 'http://localhost:3100';
  let target: URL;
  try {
    target = new URL(targetArg);
  } catch {
    console.error(`Invalid target URL: "${targetArg}"`);
    process.exit(1);
  }

  const origin = target.origin;
  console.log(`\n======================================================`);
  console.log(`Bunty Biryani Centre — Production Smoke Test`);
  console.log(`Target: ${origin}`);
  console.log(`======================================================\n`);

  let allPassed = true;

  // ---------------------------------------------------------------------------
  // Check 1: Health endpoint
  // ---------------------------------------------------------------------------
  try {
    const res = await fetch(`${origin}/api/health`);
    const data = (await res.json()) as { status?: string };
    if (res.status === 200 && data.status === 'ok') {
      record('1. Health Check', 'GET /api/health', 'PASS', `status 200, { status: "ok" }`);
    } else {
      record(
        '1. Health Check',
        'GET /api/health',
        'FAIL',
        `expected 200 { status: "ok" }, got ${res.status} ${JSON.stringify(data)}`,
      );
      allPassed = false;
    }
  } catch (err) {
    record('1. Health Check', 'GET /api/health', 'FAIL', `Request failed: ${String(err)}`);
    allPassed = false;
  }

  // ---------------------------------------------------------------------------
  // Check 2: Root and Security Headers
  // ---------------------------------------------------------------------------
  try {
    const res = await fetch(`${origin}/`);
    const csp = res.headers.get('content-security-policy');
    const hsts = res.headers.get('strict-transport-security');
    const poweredBy = res.headers.get('x-powered-by');

    if (poweredBy) {
      record('2. Security Headers', 'X-Powered-By absent', 'FAIL', `Leaking X-Powered-By header`);
      allPassed = false;
    } else {
      record('2. Security Headers', 'X-Powered-By absent', 'PASS', 'Header removed');
    }

    if (csp) {
      record('2. Security Headers', 'Content-Security-Policy', 'PASS', 'CSP header present');
    } else {
      record('2. Security Headers', 'Content-Security-Policy', 'WARN', 'CSP header missing');
    }

    if (origin.startsWith('https://')) {
      if (hsts) {
        record(
          '2. Security Headers',
          'Strict-Transport-Security',
          'PASS',
          'HSTS enabled in production',
        );
      } else {
        record(
          '2. Security Headers',
          'Strict-Transport-Security',
          'FAIL',
          'HSTS missing on HTTPS origin',
        );
        allPassed = false;
      }
    } else {
      record(
        '2. Security Headers',
        'Strict-Transport-Security',
        'PASS',
        'Skipped on non-HTTPS origin (local/test)',
      );
    }
  } catch (err) {
    record('2. Security Headers', 'GET /', 'FAIL', `Request failed: ${String(err)}`);
    allPassed = false;
  }

  // ---------------------------------------------------------------------------
  // Check 3: Menu endpoint Cache-Control
  // ---------------------------------------------------------------------------
  try {
    const res = await fetch(`${origin}/api/menu`);
    const cc = res.headers.get('cache-control');
    if (res.status === 200 && cc === 'no-store') {
      record(
        '3. API Caching',
        'GET /api/menu',
        'PASS',
        `status 200, Cache-Control: no-store strictly enforced`,
      );
    } else {
      record(
        '3. API Caching',
        'GET /api/menu',
        'FAIL',
        `expected status 200 and Cache-Control: no-store, got ${res.status} with "${cc}"`,
      );
      allPassed = false;
    }
  } catch (err) {
    record('3. API Caching', 'GET /api/menu', 'FAIL', `Request failed: ${String(err)}`);
    allPassed = false;
  }

  // ---------------------------------------------------------------------------
  // Check 4: Static assets caching & compression
  // ---------------------------------------------------------------------------
  try {
    const manifestPath = resolve('dist/client/.vite/manifest.json');
    let assetFile: string | null = null;
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
        string,
        { file?: string }
      >;
      const firstKey = Object.keys(manifest).find((k) => manifest[k]?.file?.endsWith('.js'));
      if (firstKey && manifest[firstKey]?.file) {
        assetFile = manifest[firstKey].file;
      }
    }

    if (assetFile) {
      const assetUrl = `${origin}/${assetFile}`;
      const res = await fetch(assetUrl);
      const cc = res.headers.get('cache-control') || '';
      const encoding = res.headers.get('content-encoding') || 'none (uncompressed)';

      if (res.status === 200 && cc.includes('immutable')) {
        record(
          '4. Static Asset Caching',
          `GET /${assetFile}`,
          'PASS',
          `status 200, immutable cache header verified (encoding: ${encoding})`,
        );
      } else {
        record(
          '4. Static Asset Caching',
          `GET /${assetFile}`,
          'WARN',
          `status ${res.status}, Cache-Control: "${cc}" (encoding: ${encoding})`,
        );
      }
    } else {
      record(
        '4. Static Asset Caching',
        'Asset discovery',
        'WARN',
        'Could not locate client manifest to test static asset headers',
      );
    }
  } catch (err) {
    record('4. Static Asset Caching', 'Asset request', 'WARN', `Asset check: ${String(err)}`);
  }

  // ---------------------------------------------------------------------------
  // Check 5: 404 handler returns clean JSON
  // ---------------------------------------------------------------------------
  try {
    const res = await fetch(`${origin}/api/unknown-smoke-test-endpoint`);
    const contentType = res.headers.get('content-type') || '';
    const cc = res.headers.get('cache-control');
    if (res.status === 404 && contentType.includes('application/json') && cc === 'no-store') {
      record(
        '5. 404 API Safety',
        'GET /api/unknown',
        'PASS',
        'JSON 404 with Cache-Control: no-store',
      );
    } else {
      record(
        '5. 404 API Safety',
        'GET /api/unknown',
        'FAIL',
        `expected 404 JSON, got ${res.status} ${contentType}`,
      );
      allPassed = false;
    }
  } catch (err) {
    record('5. 404 API Safety', 'GET /api/unknown', 'FAIL', `Request failed: ${String(err)}`);
    allPassed = false;
  }

  console.log(`\n------------------------------------------------------`);
  if (allPassed) {
    console.log(`RESULT: All smoke test checks PASSED cleanly.\n`);
    process.exit(0);
  } else {
    console.error(`RESULT: One or more smoke test checks FAILED.\n`);
    process.exit(1);
  }
}

void runSmokeTest();
