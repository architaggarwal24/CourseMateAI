"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return <>{this.props.fallback}</>;
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
          <div className="text-2xl">⚠️</div>
          <p className="text-sm text-text-muted">Something went wrong in this panel.</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 rounded border border-border text-xs text-text-muted hover:border-accent-red/50 hover:text-accent-red transition-all"
          >
            Try again
          </button>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}