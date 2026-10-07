import { Component, type ReactNode } from 'react';
import { copy } from '../copy';
import { CustomerPage } from './CustomerPage';
import { ErrorState } from './ErrorState';

interface RouteLoadErrorProps {
  /** Draw the customer header too, for a route that has none of its own. */
  withChrome?: boolean;
}

/**
 * What the customer sees when a route fails to load (a deploy while the menu was open, or a flaky
 * connection). The retry reloads the whole page: React.lazy caches a failed import, so a soft
 * retry would only show the same failure again.
 */
export function RouteLoadError({ withChrome = false }: RouteLoadErrorProps) {
  const error = (
    <ErrorState
      title={copy.common.loadPageTitle}
      message={copy.common.loadPageMessage}
      onRetry={() => {
        window.location.reload();
      }}
    />
  );
  return withChrome ? <CustomerPage>{error}</CustomerPage> : error;
}

interface RouteErrorBoundaryProps extends RouteLoadErrorProps {
  children: ReactNode;
}

/**
 * Without a boundary a rejected lazy chunk unmounts the whole React root and leaves a blank page.
 * Wrap each lazy customer route in this, inside its `Suspense`.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <RouteLoadError withChrome={this.props.withChrome ?? false} />;
    return this.props.children;
  }
}
