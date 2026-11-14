"use client";

import { AlertTriangle } from "@/components/ui/icons";
import React from "react";
import { Button } from "@/components/ui";
import { reportError } from "@/lib/monitoring";

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
    reportError(error, { componentStack: info.componentStack ?? "" });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return <>{this.props.fallback}</>;
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
          <AlertTriangle size={24} aria-hidden="true" className="text-ink-red" />
          <p className="text-sm text-fg-muted">Something went wrong in this panel.</p>
          <Button size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}