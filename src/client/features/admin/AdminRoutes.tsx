import { Link, Route, Routes } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { copy } from '../../copy';
import { LoginPage } from './auth/LoginPage';
import { RequireAdmin } from './auth/RequireAdmin';
import { AdminShell } from './layout/AdminShell';

import { SettingsPage } from './delivery/SettingsPage.js';
import { MenuItemForm } from './menu/MenuItemForm.js';
import { MenuPage } from './menu/MenuPage.js';
import { OrderDetailPage } from './orders/OrderDetailPage.js';
import { OrdersPage } from './orders/OrdersPage.js';
import { StockPage } from './stock/StockPage.js';
import { TodayPage } from './today/TodayPage.js';

function AdminNotFound() {
  return (
    <EmptyState
      title={copy.admin.notFoundTitle}
      message={copy.admin.notFoundMessage}
      icon="alert"
      action={
        <Link to="/admin">
          <Button variant="secondary">{copy.admin.backToToday}</Button>
        </Link>
      }
    />
  );
}

/** Everything under /admin. Loaded with React.lazy, so the customer bundle never contains it. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<RequireAdmin />}>
        <Route element={<AdminShell />}>
          <Route index element={<TodayPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="menu/new" element={<MenuItemForm />} />
          <Route path="menu/:id" element={<MenuItemForm />} />
          <Route path="delivery" element={<SettingsPage />} />
          <Route path="*" element={<AdminNotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
