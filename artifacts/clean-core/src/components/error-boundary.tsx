import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { YashLogo } from '@/components/yash-logo';

/** Keep failed optional downloads below the workspace owner and navigation.
 * A fresh lazy instance clears React's rejected-promise cache on explicit retry.
 * Browsers can still cache failed modules; a guarded reload handles that case.
 */
export function LazySection<P extends object>({
  load, section, componentProps, onSafeReload, canReload, onExportBackup,
}: {
  load: () => Promise<{ default: ComponentType<P> }>;
  section: string;
  componentProps: P;
  onSafeReload: () => void;
  canReload: boolean;
  onExportBackup: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const Content = useMemo(() => lazy(load), [load, attempt]);
  return (
    <ErrorBoundary
      key={attempt}
      FallbackComponent={() => (
        <div role="alert" className="rounded-lg border bg-background p-6 space-y-3">
          <h2 className="font-semibold">{section} could not be loaded</h2>
          <p className="text-sm text-muted-foreground">
            The section download may have been blocked, or the app may have been updated.
            Your assessment is still open. You can continue using the other sections.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="rounded border px-4 py-2 text-sm" onClick={() => setAttempt(value => value + 1)}>
              Retry {section.toLowerCase()}
            </button>
            <button type="button" className="rounded border px-4 py-2 text-sm disabled:opacity-50" disabled={!canReload} onClick={onSafeReload}>
              Reload saved workspace
            </button>
            <button type="button" data-testid="button-export-backup" className="rounded border px-4 py-2 text-sm" onClick={onExportBackup}>
              Export workspace backup
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            {canReload
              ? "If retry does not help, reload to get the current app files. Your saved workspace will be restored."
              : "Reload is unavailable until your latest changes are saved. Keep working, retry saving in the header, or export a workspace backup here to keep your current edits."}
          </p>
        </div>
      )}
    >
      <Suspense fallback={<div role="status" className="p-8 text-muted-foreground">Loading {section.toLowerCase()}…</div>}>
        <Content {...componentProps} />
      </Suspense>
    </ErrorBoundary>
  );
}

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg w-full text-center">
        <YashLogo className="mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-gray-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          This part of the app hit an error. The rest of the app is still
          running.
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env.DEV ? (
          <pre className="mt-4 overflow-x-auto rounded bg-gray-100 p-3 text-left text-xs text-gray-800">
            {error.message || String(error)}
          </pre>
        ) : null}
        <button
          type="button"
          onClick={resetError}
          className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
