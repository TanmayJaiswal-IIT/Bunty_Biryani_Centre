import type { AdminMenuItem, MenuItemCreateInput } from '@shared/api-types.js';
import { menuItemCreateSchema } from '../../../../shared/schemas/admin.js';

export interface MenuForm {
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  isAvailable: boolean;
}

export type FieldErrors = Partial<Record<keyof MenuForm, string>>;

export function moveItem(
  items: AdminMenuItem[],
  id: number,
  dir: -1 | 1,
): AdminMenuItem[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return items;

  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= items.length) {
    return items;
  }

  const next = [...items];
  const current = next[idx]!;
  const target = next[targetIdx]!;
  next[idx] = target;
  next[targetIdx] = current;
  return next;
}

export function sortOrderPatches(
  before: AdminMenuItem[],
  after: AdminMenuItem[],
): Array<{ id: number; sortOrder: number }> {
  const beforeMap = new Map<number, number>(
    before.map((item) => [item.id, item.sortOrder]),
  );
  const patches: Array<{ id: number; sortOrder: number }> = [];

  after.forEach((item, index) => {
    const prevSortOrder = beforeMap.get(item.id);
    if (prevSortOrder !== index) {
      patches.push({ id: item.id, sortOrder: index });
    }
  });

  return patches;
}

export function formFromItem(item?: AdminMenuItem): MenuForm {
  if (!item) {
    return {
      name: '',
      description: '',
      price: '',
      imageUrl: '',
      isAvailable: true,
    };
  }

  return {
    name: item.name,
    description: item.description ?? '',
    price: String(item.price),
    imageUrl: item.imageUrl ?? '',
    isAvailable: item.isAvailable,
  };
}

export function previewableImage(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formToBody(form: MenuForm): {
  body?: MenuItemCreateInput;
  fieldErrors: FieldErrors;
} {
  const priceNum = form.price.trim() === '' ? NaN : Number(form.price);
  const rawData = {
    name: form.name,
    description: form.description || undefined,
    price: priceNum,
    imageUrl: form.imageUrl || undefined,
    isAvailable: form.isAvailable,
  };

  const parsed = menuItemCreateSchema.safeParse(rawData);
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof MenuForm | undefined;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  return { body: parsed.data, fieldErrors: {} };
}
