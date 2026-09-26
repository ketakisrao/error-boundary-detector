interface Props { message: string }

/** A named demo component whose React error-boundary frame identifies Payments. */
export function CreditCardBanner({ message }: Props): never {
  throw new TypeError(message);
}
CreditCardBanner.displayName = 'credit-card-banner';
// React's errorInfo.componentStack uses the runtime function name in this build.
Object.defineProperty(CreditCardBanner, 'name', { value: 'credit-card-banner' });
