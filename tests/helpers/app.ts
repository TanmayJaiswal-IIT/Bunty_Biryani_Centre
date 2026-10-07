import type { Express } from 'express';
import { createApp, type AppLimits } from '../../src/server/app';
import { loadConfig, type Config } from '../../src/server/config';
import type { PrismaClient } from '../../src/server/db';
import { createLogger, silentLogger, type Logger } from '../../src/server/lib/logger';
import { createTestClock, type TestClock } from './clock';
import { prisma as testPrisma } from './db';

export const APP_ORIGIN = 'http://localhost:3000';

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    APP_ORIGIN,
  });
  return { ...base, ...overrides };
}

export interface MakeAppOptions {
  /** ISO instant for the test clock. */
  now?: string;
  limits?: Partial<AppLimits>;
  config?: Partial<Config>;
  clientDir?: string | null;
  prisma?: PrismaClient;
  /** Defaults to the silent logger. */
  logger?: Logger;
}

export function makeApp(options: MakeAppOptions = {}): {
  app: Express;
  clock: TestClock;
  config: Config;
} {
  const clock = createTestClock(options.now);
  const config = testConfig(options.config);
  const app = createApp({
    prisma: options.prisma ?? testPrisma,
    clock,
    config,
    logger: options.logger ?? silentLogger,
    limits: options.limits,
    clientDir: options.clientDir ?? null,
  });
  return { app, clock, config };
}

export type CapturedLine = { level: string; msg: string } & Record<string, unknown>;

/** A real logger that collects its JSON lines in memory, for asserting on log events. */
export function captureLogger(): { logger: Logger; lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  const logger = createLogger((line) => {
    lines.push(JSON.parse(line) as CapturedLine);
  });
  return { logger, lines };
}
