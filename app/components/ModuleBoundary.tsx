'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/client/telemetry';
import { Button, Notice } from './ui';

type Props = {
  /** Fallback title, already translated, e.g. "Notes and voice notes isn't available right now". */
  title: string;
  body: string;
  retryLabel: string;
  children: ReactNode;
};

type State = { failed: boolean };

/**
 * Contains a crash to one panel of the page. If, say, the voice-note recorder throws while
 * rendering, only that panel is replaced by a short message; scanning and saving keep working.
 */
export default class ModuleBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ui] ${this.props.title}:`, error, info.componentStack);
    reportError(error, 'boundary');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice tone="warning" title={this.props.title} urgent>
        <p>{this.props.body}</p>
        <div>
          <Button variant="ghost" onClick={() => this.setState({ failed: false })}>{this.props.retryLabel}</Button>
        </div>
      </Notice>
    );
  }
}
