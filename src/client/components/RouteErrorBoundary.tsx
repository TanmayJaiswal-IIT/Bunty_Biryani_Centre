import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copy } from '../copy';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  withChrome?: boolean;
}

interface State {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Route chunk load failure:', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <h2 className="text-lg font-bold text-neutral-900">{copy.common.genericError}</h2>
          <p className="text-sm text-neutral-600">{copy.common.networkError}</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-2 rounded-control bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            {copy.common.tryAgain}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
