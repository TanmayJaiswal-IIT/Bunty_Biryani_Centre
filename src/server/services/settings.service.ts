import { AppError } from '../lib/app-error.js';
import type { SettingsUpdateOutput } from '../../shared/schemas/admin.js';
import type { AdminSettings } from '../../shared/schemas/admin-views.js';
import type { AdminDeps } from './admin-orders.service.js';
import { ADMIN_TX_OPTIONS } from './admin-orders.service.js';
import { toAdminSettings } from './admin-views.js';

/**
 * Returns current delivery settings for admin.
 */
export async function getAdminSettings(deps: AdminDeps): Promise<AdminSettings> {
  const row = await deps.prisma.deliverySettings.findUniqueOrThrow({
    where: { id: 1 },
  });
  return toAdminSettings(row);
}

/**
 * Updates delivery settings using Decision 6 row locking and merged-row validation.
 */
export async function updateSettings(
  deps: AdminDeps,
  patch: SettingsUpdateOutput,
): Promise<AdminSettings> {
  return await deps.prisma.$transaction(async (tx) => {
    // 1. Lock settings row
    const rows = await tx.$queryRaw<
      Array<{
        id: number;
        orders_paused: boolean;
        express_enabled: boolean;
        express_fee: number;
        express_eta_min_minutes: number;
        express_eta_max_minutes: number;
        express_opens_at: string;
        express_closes_at: string;
        batch_fee: number;
        contact_phone: string | null;
      }>
    >`SELECT id, orders_paused, express_enabled, express_fee, express_eta_min_minutes, express_eta_max_minutes, express_opens_at, express_closes_at, batch_fee, contact_phone FROM delivery_settings WHERE id = 1 FOR UPDATE`;

    const [current] = rows;
    if (!current) {
      throw new AppError('NOT_FOUND', 'Settings not found.');
    }

    // 2. Merge patch
    const mergedEtaMin = patch.expressEtaMinMinutes ?? current.express_eta_min_minutes;
    const mergedEtaMax = patch.expressEtaMaxMinutes ?? current.express_eta_max_minutes;
    const mergedOpens = patch.expressOpensAt ?? current.express_opens_at;
    const mergedCloses = patch.expressClosesAt ?? current.express_closes_at;

    // 3. Validate merged row
    if (mergedEtaMin > mergedEtaMax) {
      throw new AppError('VALIDATION_ERROR', 'Minimum ETA cannot exceed maximum ETA.', {
        fieldErrors: {
          expressEtaMinMinutes: ['Minimum ETA cannot exceed maximum ETA.'],
        },
      });
    }

    if (mergedOpens >= mergedCloses) {
      throw new AppError('VALIDATION_ERROR', 'Opening time must be earlier than closing time.', {
        fieldErrors: {
          expressOpensAt: ['Opening time must be earlier than closing time.'],
        },
      });
    }

    // 4. Write
    const updated = await tx.deliverySettings.update({
      where: { id: 1 },
      data: patch,
    });

    return toAdminSettings(updated);
  }, ADMIN_TX_OPTIONS);
}
