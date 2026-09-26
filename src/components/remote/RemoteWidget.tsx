interface Props { message: string }

export function RemoteWidget({ message }: Props): never {
  throw new TypeError(message);
}
RemoteWidget.displayName = 'remote-widget';
// React's errorInfo.componentStack uses the runtime function name in this build.
Object.defineProperty(RemoteWidget, 'name', { value: 'remote-widget' });
