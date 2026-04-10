import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import App from './App';
import './styles.css';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('sloparena-web crashed', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground">
          <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
            <div className="w-full rounded-sm border border-border/80 bg-card/80 p-6 backdrop-blur">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">SlopArena</p>
              <h1 className="mt-3 text-3xl font-medium tracking-[-0.06em]">The leaderboard hit malformed data.</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                The page recovered instead of crashing. Try refreshing once, and if the problem persists, the API is likely returning a bad payload.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-5 inline-flex h-10 items-center justify-center rounded-sm border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing root element for SlopArena web app');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
