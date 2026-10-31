// Validation and abuse limits (Batch 1 §6.11). These are rules, not business data, so they live in code.

export const MAX_QTY_PER_ITEM = 10;
export const MAX_LINES_PER_ORDER = 10;
/** MN4: show 'Only N left' at or below this. */
export const LOW_STOCK_THRESHOLD = 5;
/** Open (ORDER_RECEIVED) orders per phone for today. Prank limiter (Batch 1 D7). */
export const MAX_OPEN_ORDERS_PER_PHONE = 3;

export const NAME_MIN = 2;
export const NAME_MAX = 60;
export const ADDRESS_MAX = 120;

export const LOGIN_MIN_PASSWORD = 10;
export const LOGIN_MAX_PASSWORD = 200;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 40;

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

const MINUTE = 60_000;

/** Generous on purpose: a hostel's students share one Wi-Fi NAT IP. Stops scripts, not people. */
export const ORDER_RATE_LIMIT: RateLimitRule = { windowMs: 10 * MINUTE, max: 60 };
/** Counts failed lookups only (Batch 1 §6.11). Stops order-number enumeration. */
export const LOOKUP_RATE_LIMIT: RateLimitRule = { windowMs: 10 * MINUTE, max: 30 };
/** Counts failed logins only (brief §22). */
export const LOGIN_RATE_LIMIT: RateLimitRule = { windowMs: 15 * MINUTE, max: 10 };

/** Admin session length: 14 days (Batch 1 §9.1). */
export const SESSION_DAYS = 14;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/** Postgres `int` ceiling; path ids above this are 404 (Batch 1 §8.1). */
export const MAX_PATH_ID = 2_147_483_647;

export const ADMIN_SEARCH_MAX = 20; // q length
export const ADMIN_ORDERS_LIMIT = 500; // list cap, newest first
export const COMPLETE_MANY_MAX = 200;
export const STOCK_BULK_MAX = 100;
export const STOCK_MAX = 10_000;
export const PRICE_MAX = 10_000;
export const ITEM_NAME_MIN = 2;
export const ITEM_NAME_MAX = 60;
export const ITEM_DESCRIPTION_MAX = 200;
export const IMAGE_URL_MAX = 500;
export const LOCATION_NAME_MIN = 2;
export const LOCATION_NAME_MAX = 40;
export const SORT_ORDER_MAX = 9_999;
export const FEE_MAX = 500;
export const ETA_MINUTES_MIN = 1;
export const ETA_MINUTES_MAX = 180;
export const PHONE_SUFFIX_MIN = 4;
