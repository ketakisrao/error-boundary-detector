interface Props { message: string }

/** The des- namespace belongs to Platform / Design Systems. */
export function DesButton({ message }: Props): never {
  throw new TypeError(message);
}
DesButton.displayName = 'des-button';
// React's errorInfo.componentStack uses the runtime function name in this build.
Object.defineProperty(DesButton, 'name', { value: 'des-button' });
