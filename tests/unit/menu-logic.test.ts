import { describe, expect, it } from 'vitest';
import type { AdminMenuItem } from '../../src/shared/api-types';
import {
  formFromItem,
  formToBody,
  moveItem,
  previewableImage,
  sortOrderPatches,
} from '../../src/client/features/admin/menu/menu-logic';

function makeItem(id: number, sortOrder: number, name = `Item ${id}`): AdminMenuItem {
  return {
    id,
    name,
    description: null,
    price: 150,
    imageUrl: null,
    isAvailable: true,
    sortOrder,
    dailyStock: 20,
    stockRemaining: 20,
    stockDate: '2026-10-04',
    stockSetToday: true,
    soldToday: 0,
  };
}

describe('Menu logic (ML1-ML3)', () => {
  it('ML1: moveItem at the edges is a no-op', () => {
    const items = [makeItem(1, 0), makeItem(2, 1), makeItem(3, 2)];

    // Moving top item up is a no-op
    expect(moveItem(items, 1, -1)).toBe(items);

    // Moving bottom item down is a no-op
    expect(moveItem(items, 3, 1)).toBe(items);

    // Moving missing item is a no-op
    expect(moveItem(items, 999, 1)).toBe(items);

    // Valid move works
    const moved = moveItem(items, 2, -1);
    expect(moved.map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('ML2: sortOrderPatches after swapping two of four (with equal initial sortOrders) renumbers correctly', () => {
    // Four items with equal initial sortOrder 0
    const items = [
      makeItem(1, 0),
      makeItem(2, 0),
      makeItem(3, 0),
      makeItem(4, 0),
    ];

    // Swap item 1 and item 2
    const swapped = moveItem(items, 2, -1);
    expect(swapped.map((i) => i.id)).toEqual([2, 1, 3, 4]);

    const patches = sortOrderPatches(items, swapped);

    // Initial sortOrders were all 0:
    // index 0 (id 2): target 0, prev was 0 -> no patch needed
    // index 1 (id 1): target 1, prev was 0 -> patch { id: 1, sortOrder: 1 }
    // index 2 (id 3): target 2, prev was 0 -> patch { id: 3, sortOrder: 2 }
    // index 3 (id 4): target 3, prev was 0 -> patch { id: 4, sortOrder: 3 }
    expect(patches).toEqual([
      { id: 1, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
      { id: 4, sortOrder: 3 },
    ]);

    // When already correctly numbered 0, 1, 2, 3:
    const ordered = [
      makeItem(1, 0),
      makeItem(2, 1),
      makeItem(3, 2),
      makeItem(4, 3),
    ];
    const swappedOrdered = moveItem(ordered, 2, -1); // [2, 1, 3, 4]
    const patchesOrdered = sortOrderPatches(ordered, swappedOrdered);
    expect(patchesOrdered).toEqual([
      { id: 2, sortOrder: 0 },
      { id: 1, sortOrder: 1 },
    ]);
  });

  it('ML3: formToBody validation and previewableImage', () => {
    // Valid form
    const valid = formToBody({
      name: 'Paneer Biryani',
      description: 'Fresh paneer and basmati rice',
      price: '140',
      imageUrl: 'https://example.com/paneer.webp',
      isAvailable: true,
    });
    expect(valid.body).toBeDefined();
    expect(valid.body?.name).toBe('Paneer Biryani');
    expect(valid.body?.price).toBe(140);
    expect(valid.fieldErrors).toEqual({});

    // Price of 0 -> field error
    const zeroPrice = formToBody({
      name: 'Paneer Biryani',
      description: '',
      price: '0',
      imageUrl: '',
      isAvailable: true,
    });
    expect(zeroPrice.body).toBeUndefined();
    expect(zeroPrice.fieldErrors.price).toBe('Price must be positive');

    // http:// image -> field error
    const httpImage = formToBody({
      name: 'Paneer Biryani',
      description: '',
      price: '140',
      imageUrl: 'http://example.com/pic.jpg',
      isAvailable: true,
    });
    expect(httpImage.body).toBeUndefined();
    expect(httpImage.fieldErrors.imageUrl).toBe('Image URL must use https');

    // previewableImage checks
    expect(previewableImage('https://example.com/pic.jpg')).toBe(true);
    expect(previewableImage('http://example.com/pic.jpg')).toBe(false);
    expect(previewableImage('ftp://example.com/pic.jpg')).toBe(false);
    expect(previewableImage('')).toBe(false);

    // formFromItem
    expect(formFromItem()).toEqual({
      name: '',
      description: '',
      price: '',
      imageUrl: '',
      isAvailable: true,
    });
  });
});
