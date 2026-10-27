import { Link } from 'react-router';
import { Banner } from '../../../components/Banner';
import { copy } from '../../../copy';
import { useDashboard } from '../api/hooks';

export function PausedStrip() {
  const { data } = useDashboard();

  if (!data?.controls.ordersPaused) {
    return null;
  }

  return (
    <Banner tone="warning" className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <span>{copy.admin.ordersPausedBanner}</span>
        <Link to="/admin" className="text-xs font-semibold underline">
          {copy.admin.viewToday}
        </Link>
      </div>
    </Banner>
  );
}
