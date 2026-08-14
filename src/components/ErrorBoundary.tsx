import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          background: "#05070F",
          color: "#E7ECF8",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p style={{ opacity: 0.7, maxWidth: 560, margin: 0 }}>
          {this.state.error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            padding: "8px 18px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(56,189,248,0.15)",
            color: "#38BDF8",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
