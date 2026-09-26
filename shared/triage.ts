import { z } from 'zod';

export interface SanitizedProps { [key: string]: Record<string, unknown> | null }
export interface ErrorContextEnvelope {
  errorName: string;
  errorMessage: string;
  componentStack: string[];
  callStack: string[];
  hostRoute: string;
  sanitizedProps: SanitizedProps;
  timestamp: string;
}
export const teams = ['Payments', 'Vendors', 'Cart', 'Tax & Compliance', 'Platform', 'Products', 'Reviews', 'Shipping', 'Promotions'] as const;
export type Team = typeof teams[number];
export const envelopeSchema = z.object({
  errorName: z.string().min(1).max(100), errorMessage: z.string().min(1).max(1000),
  componentStack: z.array(z.string().max(500)).min(1).max(40),
  callStack: z.array(z.string().max(500)).max(60),
  hostRoute: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/).max(150),
  sanitizedProps: z.record(z.record(z.unknown()).nullable()), timestamp: z.string().datetime(),
}).strict();
const probability = z.number().min(0).max(1);
const distribution = (keys: readonly string[]) => z.record(probability).superRefine((value, ctx) => {
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value)) || Math.abs(Object.values(value).reduce((a, b) => a + b, 0) - 1) > 0.015) {
    ctx.addIssue({ code: 'custom', message: 'Invalid probability distribution' });
  }
});
export const answersSchema = z.object({
  owner: z.object({ type: z.literal('choice'), choice: z.enum(teams), probabilities: distribution(teams), confidence: probability }),
  contract: z.object({ type: z.literal('noul'), noul: probability }),
  severity: z.object({ type: z.literal('score'), score: z.number().min(0).max(3), confidence: probability,
    probabilities: distribution(['0', '1', '2', '3']), legend: z.record(z.string()) }),
}).superRefine((answers, ctx) => {
  const owner = answers.owner;
  const expectedScore = Object.entries(answers.severity.probabilities).reduce((sum, [key, value]) => sum + Number(key) * value, 0);
  if (Object.values(owner.probabilities).some(value => value > owner.probabilities[owner.choice]) || Math.abs(expectedScore - answers.severity.score) > 0.02) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent model response' });
  }
});
export type Answers = z.infer<typeof answersSchema>;
export interface Decision {
  id: string; timestamp: string; mode: 'demo' | 'live'; model: string;
  envelope: ErrorContextEnvelope; answers: Answers | null;
  team: Team | 'Needs review'; status: 'Routed' | 'Needs review';
  severity: 'Critical' | 'High' | 'Medium' | 'Unknown';
  latencyMs: number; reason: string;
}
export const policy = { probability: 0.85, confidence: 0.75, contract: 0.85, severityConfidence: 0.6, budgetMs: 200 };
export const registry = {
  // Routes identify the team receiving the original alert, never the embedded owner.
  routes: { '/vendors': 'Vendors', '/cart': 'Cart', '/checkout': 'Payments' },
  components: {
    'promotion-summary': { team: 'Promotions' as Team, requiredProp: 'promotion', contract: 'promotion must be a non-null object' },
    'shipping-estimate': { team: 'Shipping' as Team, requiredProp: 'shipment', contract: 'shipment must be a non-null object' },
    'product-review-summary': { team: 'Reviews' as Team, requiredProp: 'reviews', contract: 'reviews must be a non-null object' },
    'product-variant-summary': { team: 'Products' as Team, requiredProp: 'product', contract: 'product must be a non-null object' },
    'cart-item-list': { team: 'Cart' as Team, requiredProp: 'cart', contract: 'cart must be a non-null object' },
    'cart-summary': { team: 'Cart' as Team, requiredProp: 'cart', contract: 'cart must be a non-null object' },
    'cart-quantity-picker': { team: 'Cart' as Team, requiredProp: 'cart', contract: 'cart must be a non-null object' },
    'cart-promo-code': { team: 'Cart' as Team, requiredProp: 'cart', contract: 'cart must be a non-null object' },
    'cart-shipping-estimate': { team: 'Cart' as Team, requiredProp: 'cart', contract: 'cart must be a non-null object' },
    'credit-card-banner': { team: 'Payments' as Team, requiredProp: 'payment', contract: 'payment must be a non-null object' },
    'tax-onboarding-form': { team: 'Tax & Compliance' as Team, requiredProp: 'profile', contract: 'profile must be a non-null object' },
    'vendor-summary': { team: 'Vendors' as Team, requiredProp: 'vendor', contract: 'vendor must be a non-null object' },
  },
  prefixes: [
    { prefix: 'des-', team: 'Platform' as Team, description: 'Platform / Design Systems owns components such as des-button and des-select.', requiredProp: 'theme', contract: 'For these demo design-system components, theme must be a non-null object.' },
  ],
};

export function componentName(frame: string): string {
  const trimmed = frame.trim();
  return trimmed.match(/^at\s+([^\s(]+)/)?.[1]
    ?? trimmed.match(/^<([a-zA-Z][\w-]*)\s*\/?\s*>$/)?.[1]
    ?? trimmed.split(/[@\s(]/)[0];
}

export function ownershipEvidence(envelope: ErrorContextEnvelope) {
  // React puts the throwing component first. An owning ancestor is not proof
  // that an unknown descendant belongs to that same team.
  const component = componentName(envelope.componentStack[0] ?? '');
  const exact = Object.entries(registry.components).find(([name]) => name === component)?.[1];
  if (exact) return { component, ...exact, rule: `<${component}> is registered to ${exact.team}.` };
  const prefix = registry.prefixes.find(entry => component.startsWith(entry.prefix));
  if (prefix) return { component, ...prefix, rule: `<${component}> matches the ${prefix.prefix}* prefix owned by Platform / Design Systems.` };
  return { component, team: undefined, requiredProp: undefined, rule: `No ownership rule matches <${component || 'unknown'}>.` };
}
export const severityLegend = { '0': 'Cosmetic; the feature remains usable', '1': 'One embedded feature unavailable; the host stays usable', '2': 'A critical payment or onboarding journey is blocked', '3': 'Multiple host routes unavailable or documented data loss' };
export function hostTeam(route: string): Team | undefined {
  return Object.entries(registry.routes).find(([prefix]) => route === prefix || route.startsWith(prefix + '/'))?.[1] as Team | undefined;
}
export function routeDecision(answers: Answers, envelope: ErrorContextEnvelope): { team: Decision['team']; reason: string } {
  const { owner, contract, severity } = answers;
  const knownHost = hostTeam(envelope.hostRoute);
  if (owner.probabilities[owner.choice] < policy.probability || owner.confidence < policy.confidence || severity.confidence < policy.severityConfidence) {
    return { team: 'Needs review', reason: 'The model is below the automatic routing confidence threshold.' };
  }
  if (contract.noul > 1 - policy.contract && contract.noul < policy.contract) {
    return { team: 'Needs review', reason: 'The host prop contract could not be established confidently.' };
  }
  if (contract.noul <= 1 - policy.contract && (!knownHost || owner.choice !== knownHost)) {
    return { team: 'Needs review', reason: 'Ownership and the host contract evidence disagree. A human should review this incident.' };
  }
  const evidence = ownershipEvidence(envelope);
  if (contract.noul >= policy.contract && (!evidence.team || evidence.team !== owner.choice)) {
    return { team: 'Needs review', reason: `${evidence.rule} The model decision needs review against the throwing component, not the host URL.` };
  }
  return { team: owner.choice, reason: contract.noul >= policy.contract
    ? `${evidence.rule} It threw on ${envelope.hostRoute}; the host supplied valid props.`
    : `<${evidence.component}> received props that violate its contract. The ${knownHost} host owns this fault.` };
}

// Preserve only structure; never transmit values from component props.
export function sanitizeProps(props: Record<string, unknown>): SanitizedProps {
  return Object.fromEntries(Object.entries(props).slice(0, 30).map(([component, value]) => [component,
    value === null ? null : typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, entry]) => [key,
        entry === null ? null : { type: Array.isArray(entry) ? 'array' : typeof entry }]))
      : { type: typeof value },
  ]));
}
export const scenarios = [
  { id: 'component', name: 'credit-card-banner breaks', component: 'credit-card-banner', description: 'A Payments component throws inside the Vendors page.', message: "Cannot read properties of undefined (reading 'last4')", contract: true, score: 2.1 },
  { id: 'contract', name: 'credit-card-banner receives invalid props', component: 'credit-card-banner', description: 'The Vendors host passes null to a required payment prop.', message: "Cannot read properties of null (reading 'id')", contract: false, score: 1.9 },
  { id: 'design-button', name: 'des-button breaks', component: 'des-button', description: 'A design-system button throws inside the same Vendors page.', message: "Cannot read properties of undefined (reading 'foreground')", contract: true, score: 1.8 },
  { id: 'ambiguous', name: 'Unknown component breaks', component: 'remote-widget', description: 'An unregistered component throws. Its owning team is unclear.', message: 'An unknown error occurred in a remote module', contract: true, score: 1.4 },
  { id: 'design-select', name: 'des-select breaks', component: 'des-select', description: 'A design-system select throws inside the same Vendors page.', message: "Cannot read properties of undefined (reading 'selectedIndex')", contract: true, score: 1.8 },
] as const;
export type Scenario = typeof scenarios[number];
export function scenarioEnvelope(scenario: Scenario, route = '/vendors'): ErrorContextEnvelope {
  return {
    errorName: 'TypeError', errorMessage: scenario.message,
    componentStack: [scenario.component, 'VendorPage', 'App'],
    // Initial examples have opaque source locations, with no team names to infer from.
    callStack: ['assets/widgets.js:42:18', 'assets/app.js:86:7'], hostRoute: route,
    sanitizedProps: sanitizeProps({ [scenario.component]: scenario.component === 'credit-card-banner'
      ? { payment: scenario.contract ? { id: 'synthetic' } : null }
      : scenario.component.startsWith('des-') ? { theme: { mode: 'synthetic' } } : {} }),
    timestamp: new Date().toISOString(),
  };
}

// Local demo probabilities are illustrative. Ownership is derived from the
// supplied throwing component and prop evidence, not a scenario ID or message.
export function demoAnswers(envelope: ErrorContextEnvelope): Answers {
  const evidence = ownershipEvidence(envelope);
  const props = envelope.sanitizedProps[evidence.component];
  const prop = evidence.requiredProp ? props?.[evidence.requiredProp] : undefined;
  const violated = prop === null;
  const upheld = typeof prop === 'object' && prop !== null && 'type' in prop && prop.type === 'object';
  const uncertain = !evidence.team || (!violated && !upheld) || (violated && !hostTeam(envelope.hostRoute));
  const owner = (violated ? hostTeam(envelope.hostRoute) : evidence.team) ?? 'Vendors';
  const probability = uncertain ? 0.46 : 0.982;
  const score = evidence.component === 'credit-card-banner' ? violated ? 1.9 : 2.1 : evidence.component.startsWith('des-') ? 1.8 : 1.4;
  const lower = Math.floor(score);
  const upperWeight = score - lower;
  return {
    owner: { type: 'choice', choice: owner, confidence: uncertain ? 0.32 : 0.96,
      probabilities: Object.fromEntries(teams.map(team => [team, team === owner ? probability : (1 - probability) / (teams.length - 1)])) },
    contract: { type: 'noul', noul: uncertain ? 0.52 : violated ? 0.02 : 0.99 },
    severity: { type: 'score', score, confidence: 0.86, legend: severityLegend,
      probabilities: Object.fromEntries([0, 1, 2, 3].map(level => [String(level), level === lower ? 1 - upperWeight : level === lower + 1 ? upperWeight : 0])) },
  };
}
export function fixtureAnswers(scenario: Scenario, route: string): Answers {
  return demoAnswers(scenarioEnvelope(scenario, route));
}
