import { Component, type ErrorInfo, type ReactNode } from 'react';
import { scenarioEnvelope, type ErrorContextEnvelope, type Scenario } from '../shared/triage';
import { CreditCardBanner } from './components/payments/CreditCardBanner';
import { DesButton } from './components/design-system/DesButton';
import { DesSelect } from './components/design-system/DesSelect';
import { RemoteWidget } from './components/remote/RemoteWidget';

interface Props { scenario: Scenario; route: string; onCapture: (envelope: ErrorContextEnvelope) => void; children: ReactNode }
export class ErrorCapture extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const context = scenarioEnvelope(this.props.scenario, this.props.route);
    const frames = info.componentStack?.split('\n').map(frame => frame.trim()).filter(Boolean).slice(0, 40) ?? [];
    this.props.onCapture({ ...context, errorName: error.name, errorMessage: error.message,
      // Keep React's complete frames: "at Component (source:line:column)".
      // The server extracts the first name for routing and forwards these frames to Jev.
      componentStack: frames.length ? frames : ['unknown'],
      callStack: error.stack?.split('\n').slice(1, 40) ?? [], timestamp: new Date().toISOString() });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

export function FaultyComponent({ scenario }: { scenario: Scenario }): ReactNode {
  switch (scenario.id) {
    case 'component':
    case 'contract': return <CreditCardBanner message={scenario.message} />;
    case 'design-button': return <DesButton message={scenario.message} />;
    case 'design-select': return <DesSelect message={scenario.message} />;
    case 'ambiguous': return <RemoteWidget message={scenario.message} />;
  }
}
