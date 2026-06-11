import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string;
}

// Catches render/runtime errors so a crash shows a readable message
// instead of a blank (black, in dark mode) screen.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info);
    this.setState({ info: info.componentStack ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <h2>Something broke while rendering</h2>
          <pre className="crash-msg">{String(this.state.error?.stack || this.state.error)}</pre>
          {this.state.info && <pre className="crash-stack">{this.state.info}</pre>}
          <button className="primary" onClick={() => this.setState({ error: null, info: "" })}>
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
