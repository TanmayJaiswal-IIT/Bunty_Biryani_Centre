import { MAX_PATH_ID } from '../../shared/limits.js';
import { AppError } from './app-error.js';

/**
 * Parses a `:id` route param. Anything that is not a positive integer up to the Postgres `int`
 * ceiling is a `404`, so a huge id never reaches the database and fails as a `500` (Batch 1 §8.1).
 */
export function pathId(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,10}$/.test(raw)) throw new AppError('NOT_FOUND', 'Not found.');
  const id = Number(raw);
  if (id < 1 || id > MAX_PATH_ID) throw new AppError('NOT_FOUND', 'Not found.');
  return id;
}
