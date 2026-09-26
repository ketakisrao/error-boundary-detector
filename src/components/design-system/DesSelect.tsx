interface Props { message: string }

/** Another component owned by the same namespace rule. */
export function DesSelect({ message }: Props): never {
  throw new TypeError(message);
}
DesSelect.displayName = 'des-select';
// React's errorInfo.componentStack uses the runtime function name in this build.
Object.defineProperty(DesSelect, 'name', { value: 'des-select' });
