import { MAX_PATH_ID } from '../../shared/limits.js';
import { AppError } from './app-error.js';

/**
 * Validates and parses a path integer ID (Batch 1 §8.1).
 * '57' -> 57. Not /^\d{1,10}$/, < 1, or > MAX_PATH_ID -> throw AppError('NOT_FOUND', 'Not found.').
 */
export function pathId(raw: string | undefined): number {
  if (!raw || !/^\d{1,10}$/.test(raw)) {
    throw new AppError('NOT_FOUND', 'Not found.');
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_PATH_ID) {
    throw new AppError('NOT_FOUND', 'Not found.');
  }
  return id;
}
