'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-background text-foreground">
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
          <div className="rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400 p-4 mb-4">
            <span className="text-2xl font-bold">!</span>
          </div>
          <h2 className="text-xl font-bold mb-2">Application Error</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-6">
            {error.message || 'An unexpected error occurred. Please try reloading the page.'}
          </p>
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
