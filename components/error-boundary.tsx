'use client';

/**
 * App-wide React error boundary. Keeps a render failure from white-screening
 * the window — shows the message plus a reload action instead. Errors are
 * also logged for the Tauri log plugin.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
          <AlertTriangle className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
