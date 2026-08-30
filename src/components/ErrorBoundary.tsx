'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Card className="m-auto max-w-2xl border-destructive">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle /> Something Went Wrong
                </CardTitle>
                <CardDescription>
                    An unexpected error occurred while rendering this part of the page.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div>
                    <h3 className="font-semibold">Error Message:</h3>
                    <p className="text-sm text-destructive">{this.state.error?.message}</p>
                 </div>
                 <div>
                    <h3 className="font-semibold">Stack Trace:</h3>
                    <pre className="mt-2 w-full whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-sm text-muted-foreground">
                        {this.state.error?.stack}
                    </pre>
                 </div>
                 <Button onClick={() => this.setState({ hasError: false, error: undefined })}>
                     Try to render again
                 </Button>
            </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
