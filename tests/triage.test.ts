import { describe, expect, it, vi } from 'vitest';
import { answersSchema, componentName, envelopeSchema, fixtureAnswers, ownershipEvidence, routeDecision, sanitizeProps, scenarioEnvelope, scenarios } from '../shared/triage';
import { evaluate } from '../server/engine';

const envelope = scenarioEnvelope(scenarios[0]);
const good = () => fixtureAnswers(scenarios[0], envelope.hostRoute);
const provider = (answers: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ model: 'jev-test', answers }), { status }));
describe('attribution and contract gates', () => {
  it.each([[0, 'Payments'], [1, 'Vendors'], [2, 'Platform'], [3, 'Needs review'], [4, 'Platform']])('scenario %s routes to %s', async (index, team) => {
    const decision = await evaluate(scenarioEnvelope(scenarios[Number(index)]), 'demo');
    expect(decision.team).toBe(team);
    expect(decision.mode).toBe('demo');
  });
  it('assigns a violated contract to the actual host rather than always Vendors', async () => {
    expect((await evaluate(scenarioEnvelope(scenarios[1], '/checkout'), 'demo')).team).toBe('Payments');
    expect((await evaluate(scenarioEnvelope(scenarios[1], '/cart'), 'demo')).team).toBe('Cart');
    expect((await evaluate(scenarioEnvelope(scenarios[0], '/cart'), 'demo')).team).toBe('Payments');
  });
  it('holds inconsistent ownership and contract evidence for review', () => {
    const answers = good(); answers.contract.noul = .01;
    expect(routeDecision(answers, envelope).team).toBe('Needs review');
  });
  it('requires probability and confidence separately', () => {
    const answers = good(); answers.owner.confidence = .5;
    expect(routeDecision(answers, envelope).team).toBe('Needs review');
  });
  it('holds uncertain severity despite high ownership confidence', () => {
    const answers = good(); answers.severity.confidence = .4;
    expect(routeDecision(answers, envelope).team).toBe('Needs review');
  });
  it('does not assign unknown hosts from a violated contract', () => {
    expect(routeDecision(fixtureAnswers(scenarios[1], '/unknown'), { ...envelope, hostRoute: '/unknown' }).team).toBe('Needs review');
  });
});
describe('live Jev boundary', () => {
  it('sends all three typed questions together with trusted ownership data', async () => {
    const fetcher = provider(good());
    const decision = await evaluate(envelope, 'live', { key: 'synthetic-test-key', fetcher });
    expect(decision.team).toBe('Payments');
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.questions.owner.type).toBe('choice');
    expect(request.questions.contract.type).toBe('noul');
    expect(request.questions.severity.type).toBe('score');
    expect(request.state.registry.components['credit-card-banner'].team).toBe('Payments');
    expect(request.state.envelope).toEqual(envelope);
    expect(decision.model).toBe('jev-test');
  });
  it('never silently substitutes demo results for missing credentials', async () => {
    const decision = await evaluate(envelope, 'live');
    expect(decision.status).toBe('Needs review');
    expect(decision.answers).toBeNull();
    expect(decision.mode).toBe('live');
  });
  it.each([401, 429, 529])('holds provider HTTP %s errors for review', async status => {
    const result = await evaluate(envelope, 'live', { key: 'test', fetcher: provider({}, status) });
    expect(result.status).toBe('Needs review'); expect(result.reason).toContain(String(status));
  });
  it('holds malformed and inconsistent model output', async () => {
    const invalid = good(); invalid.owner.probabilities.Payments = 3;
    expect(answersSchema.safeParse(invalid).success).toBe(false);
    const result = await evaluate(envelope, 'live', { key: 'test', fetcher: provider(invalid) });
    expect(result.status).toBe('Needs review'); expect(result.answers).toBeNull();
  });
  it('rejects a choice that is not the highest-probability option', () => {
    const invalid = good(); invalid.owner.choice = 'Vendors';
    expect(answersSchema.safeParse(invalid).success).toBe(false);
  });
  it('rejects scores inconsistent with the returned distribution', () => {
    const invalid = good(); invalid.severity.score = 0;
    expect(answersSchema.safeParse(invalid).success).toBe(false);
  });
  it('aborts slow inference and keeps the event for review', async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')));
    });
    const result = await evaluate(envelope, 'live', { key: 'test', fetcher });
    expect(result.status).toBe('Needs review'); expect(result.reason).toMatch(/budget/);
  });
});
describe('telemetry validation', () => {
  it('preserves prop types and nulls without retaining user values', () => {
    expect(sanitizeProps({ 'credit-card-banner': { payment: null, email: 'private@example.com', token: 'secret', nested: { key: 'secret' } } })).toEqual({ 'credit-card-banner': { payment: null, email: { type: 'string' }, token: { type: 'string' }, nested: { type: 'object' } } });
  });
  it('rejects missing stacks, invalid dates, route queries and oversized messages', () => {
    for (const patch of [{ componentStack: [] }, { timestamp: 'yesterday' }, { hostRoute: '/vendors?token=secret' }, { errorMessage: 'x'.repeat(1001) }]) {
      expect(envelopeSchema.safeParse({ ...envelope, ...patch }).success).toBe(false);
    }
  });
});


describe('ownership from the throwing component, independent of the host URL', () => {
  it.each([[0, 'Payments'], [2, 'Platform'], [4, 'Platform']])('attributes component scenario %s on the same /vendors URL to %s', async (index, team) => {
    const context = scenarioEnvelope(scenarios[Number(index)]);
    context.errorMessage = 'An identical generic render failure';
    context.callStack = ['assets/chunk.js:1:1'];
    expect(context.hostRoute).toBe('/vendors');
    const result = await evaluate(context, 'demo');
    expect(result.team).toBe(team);
    expect(result.reason).toContain(context.componentStack[0]);
  });
  it('supports des- components beyond the named examples', async () => {
    const context = scenarioEnvelope(scenarios[2]);
    context.componentStack = ['at des-tooltip (assets/chunk.js:1:1)', 'credit-card-banner', 'VendorPage'];
    context.sanitizedProps = { 'des-tooltip': { theme: { type: 'object' } } };
    expect((await evaluate(context, 'demo')).team).toBe('Platform');
  });
  it('does not mistake a design-system ancestor for the throwing component', async () => {
    const context = scenarioEnvelope(scenarios[0]);
    context.componentStack = ['credit-card-banner', 'des-button', 'VendorPage'];
    expect((await evaluate(context, 'demo')).team).toBe('Payments');
  });
  it('does not assign an unknown throwing component from a known ancestor or payment URL', async () => {
    const context = scenarioEnvelope(scenarios[3], '/vendors/payments');
    context.componentStack = ['remote-widget', 'credit-card-banner', 'des-button'];
    const result = await evaluate(context, 'demo');
    expect(result.status).toBe('Needs review');
    expect(ownershipEvidence(context).team).toBeUndefined();
  });
  it('holds a confident live decision that contradicts component ownership', async () => {
    const context = scenarioEnvelope(scenarios[2]);
    const result = await evaluate(context, 'live', { key: 'test', fetcher: provider(good()) });
    expect(result.status).toBe('Needs review');
    expect(result.reason).toContain('des-');
  });
  it('requires actual component evidence rather than assigning from a copied error message', async () => {
    const context = scenarioEnvelope(scenarios[0]);
    context.componentStack = ['unknown', 'VendorPage'];
    expect((await evaluate(context, 'demo')).team).toBe('Needs review');
  });
  it('sends the boundary stack and prefix rules to Jev', async () => {
    const context = scenarioEnvelope(scenarios[4]);
    const fetcher = provider(fixtureAnswers(scenarios[4], '/vendors'));
    const result = await evaluate(context, 'live', { key: 'test', fetcher });
    expect(result.team).toBe('Platform');
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.state.envelope.componentStack[0]).toBe('des-select');
    expect(request.state.envelope.hostRoute).toBe('/vendors');
    expect(request.state.registry.prefixes).toContainEqual(expect.objectContaining({ prefix: 'des-', team: 'Platform' }));
    expect(request.questions.owner.instructions).toContain('Never infer component ownership from URL');
  });
});


describe('full React boundary frames', () => {
  it('keeps the source positions in the exact componentStack sent to Jev', async () => {
    const context = scenarioEnvelope(scenarios[0]);
    context.componentStack = [
      'at credit-card-banner (src/components/payments/CreditCardBanner.tsx:6:9)',
      'at FaultyComponent (src/ErrorCapture.tsx:31:30)',
      'at ErrorCapture (src/ErrorCapture.tsx:10:8)',
      'at VendorPage (src/pages/VendorPage.tsx:4:10)',
      'at App (src/App.tsx:229:17)',
    ];
    expect(componentName(context.componentStack[0])).toBe('credit-card-banner');
    const fetcher = provider(good());
    const decision = await evaluate(context, 'live', { key: 'test', fetcher });
    expect(decision.team).toBe('Payments');
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(request.state.envelope.componentStack).toEqual(context.componentStack);
    expect(decision.envelope.componentStack).toEqual(context.componentStack);
  });
  it('recognizes a design-system component from a real source frame', async () => {
    const context = scenarioEnvelope(scenarios[2]);
    context.componentStack = [
      'at des-button (src/components/design-system/DesButton.tsx:6:9)',
      'at VendorPage (src/pages/VendorPage.tsx:4:10)',
    ];
    expect((await evaluate(context, 'demo')).team).toBe('Platform');
  });
});
