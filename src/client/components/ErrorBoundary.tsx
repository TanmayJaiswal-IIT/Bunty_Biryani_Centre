import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copy } from '../copy';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
          <div className="w-full max-w-sm rounded-(--radius-card) border border-(--color-line) bg-(--color-surface) p-6 shadow-(--shadow-card)">
            <h1 className="text-xl font-bold text-(--color-ink)">{copy.common.errorBoundaryTitle}</h1>
            <p className="mt-2 text-sm text-(--color-ink-muted)">{copy.common.genericError}</p>
            <div className="mt-6">
              <Button onClick={this.handleReload} fullWidth>
                {copy.common.errorBoundaryReload}
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
