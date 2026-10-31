import { useEffect, useState } from 'react';
import { copy } from '../copy';
import { Icon } from './Icon';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return !navigator.onLine;
    }
    return false;
  });

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-(--color-danger) px-4 py-2.5 text-center text-sm font-medium text-white shadow-sm"
    >
      <Icon name="alert" className="h-4 w-4 shrink-0" />
      <span>{copy.common.offline}</span>
    </div>
  );
}
