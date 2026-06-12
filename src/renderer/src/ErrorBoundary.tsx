import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    stack: "",
  };

  static getDerivedStateFromError(error: Error): State {
    return { error, stack: "" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, stack: info.componentStack ?? "" });
    console.error(`React boundary caught: ${error.message}`);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="load-error">
          <h1>PC Audience 界面出错</h1>
          <p>{this.state.error.message}</p>
          {this.state.stack ? <pre>{this.state.stack}</pre> : null}
        </div>
      );
    }

    return this.props.children;
  }
}
