'use client';

import React from 'react';

export interface DatabaseError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface ErrorBannerProps {
  error: DatabaseError | null;
  onRetry?: () => void;
}

export function DatabaseErrorBanner({ error, onRetry }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div id="database-error-banner" className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-red-900">
            Database Query Error [{error.code || 'UNKNOWN'}]
          </h3>
          <p className="mt-1 text-sm text-red-700 font-mono bg-red-100/50 p-2 rounded break-all">
            {error.message}
          </p>
          {error.details && (
            <p className="mt-1 text-xs text-red-600">
              <strong>Details:</strong> {error.details}
            </p>
          )}
          {error.hint && (
            <p className="mt-1 text-xs text-red-600">
              <strong>Hint:</strong> {error.hint}
            </p>
          )}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors shrink-0"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export default DatabaseErrorBanner;
