import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { copy } from '../copy';

export function RouteAnnouncer() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    let title = `${copy.brand} · Order online`;

    if (path === '/checkout') {
      title = `Checkout · ${copy.brand}`;
    } else if (path.startsWith('/order/')) {
      const id = path.split('/')[2];
      title = id ? `Order #${id} · ${copy.brand}` : `Order status · ${copy.brand}`;
    } else if (path === '/track') {
      title = `Track your order · ${copy.brand}`;
    } else if (path === '/admin/login') {
      title = 'Vendor login · BBC Admin';
    } else if (path === '/admin') {
      title = 'Today · BBC Admin';
    } else if (path === '/admin/orders') {
      title = 'Orders · BBC Admin';
    } else if (path.startsWith('/admin/orders/')) {
      title = 'Order details · BBC Admin';
    } else if (path === '/admin/stock') {
      title = 'Stock · BBC Admin';
    } else if (path === '/admin/menu') {
      title = 'Menu · BBC Admin';
    } else if (path === '/admin/menu/new') {
      title = 'Add menu item · BBC Admin';
    } else if (path.startsWith('/admin/menu/')) {
      title = 'Edit menu item · BBC Admin';
    } else if (path === '/admin/delivery') {
      title = 'Settings · BBC Admin';
    }

    document.title = title;

    // Focus the primary heading for screen readers after navigation
    const timer = setTimeout(() => {
      const h1 = document.querySelector('h1');
      if (h1) {
        if (!h1.hasAttribute('tabindex')) {
          h1.setAttribute('tabindex', '-1');
        }
        h1.focus();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [location.pathname]);

  return null;
}
