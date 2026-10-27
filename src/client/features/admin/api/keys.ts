export const ADMIN_MENU_KEY = '/api/admin/menu';
export const ADMIN_LOCATIONS_KEY = '/api/admin/locations';
export const ADMIN_SLOTS_KEY = '/api/admin/delivery-slots';
export const ADMIN_SETTINGS_KEY = '/api/admin/settings';

export function dashboardKey(date?: string | null): string {
  if (date) {
    return `/api/admin/dashboard?date=${encodeURIComponent(date)}`;
  }
  return '/api/admin/dashboard';
}

export function ordersKey(q: {
  date?: string;
  mode?: string;
  status?: string;
  q?: string;
}): string {
  const params = new URLSearchParams();
  if (q.date) params.set('date', q.date);
  if (q.mode) params.set('mode', q.mode);
  if (q.status) params.set('status', q.status);
  if (q.q) params.set('q', q.q);

  const qs = params.toString();
  return qs ? `/api/admin/orders?${qs}` : '/api/admin/orders';
}

export function orderKey(id: number): string {
  return `/api/admin/orders/${id}`;
}
