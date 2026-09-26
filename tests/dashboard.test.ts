import { describe, expect, it, vi } from 'vitest';
import { applyDecision, canTriage, currentAssignment, forHost, isRerouted, parseHistory, recordReview, restoreIssues, reviewStatus, seedErrors, triageIssue } from '../src/dashboard';
import { componentName, hostTeam } from '../shared/triage';
import { evaluate, questions } from '../server/engine';

describe('host dashboard and static error fixtures', () => {
  it('starts every issue on its host team without a precomputed decision', () => {
    const errors = seedErrors();
    expect(forHost(errors, 'Cart')).toHaveLength(12);
    expect(forHost(errors, 'Vendors')).toHaveLength(4);
    expect(forHost(errors, 'Payments')).toHaveLength(2);
    expect(new Set(errors.map(item => item.id)).size).toBe(errors.length);
    for (const item of errors) {
      expect(item.team).toBe(hostTeam(item.envelope.hostRoute));
      expect(item.answers).toBeNull();
      expect(item.triageState).toBe('pending');
      expect(reviewStatus(item, {})).toBe('Awaiting triage');
      expect(item.envelope.componentStack[0]).toMatch(/^at .+ \(src\/.+:\d+:\d+\)$/);
    }
    expect(componentName(errors[0].envelope.componentStack[0])).toBe('cart-item-list');
  });
  it('routes shopping vertical failures to their owners and retains Cart faults', async () => {
    const cart = forHost(seedErrors(), 'Cart');
    const results = await Promise.all(cart.map(async item => applyDecision(item, await evaluate(item.envelope, 'demo'))));
    expect(results.filter(item => isRerouted(item, {}))).toHaveLength(8);
    expect(results.filter(item => item.team === 'Cart')).toHaveLength(4);
    expect(results.filter(item => item.team === 'Payments')).toHaveLength(2);
    expect(results.filter(item => item.team === 'Platform')).toHaveLength(2);
    expect(results.find(item => item.envelope.sanitizedProps['credit-card-banner']?.payment === null)?.team).toBe('Cart');
    for (const team of ['Products', 'Reviews', 'Shipping', 'Promotions']) {
      expect(results.filter(item => item.team === team)).toHaveLength(1);
      expect(Object.keys(questions.owner.criteria)).toContain(team);
    }
    expect(results.every(item => item.status === 'Routed')).toBe(true);
    expect(questions.owner.criteria.Cart).toContain('registered to Cart');
  });
  it('sends the full static envelope to the API and uses its measured result', async () => {
    const item = seedErrors()[1];
    const payload = { ...await evaluate(item.envelope, 'demo'), latencyMs: 137 };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
    const result = await triageIssue(item, 'live', fetcher);
    expect(fetcher.mock.calls[0][0]).toBe('/api/triage');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ mode: 'live', envelope: item.envelope });
    expect(result.latencyMs).toBe(137);
    expect(result.id).toBe(item.id);
    expect(result.envelope).toEqual(item.envelope);
    expect(result.timestamp).toBe(item.timestamp);
    expect(result.team).toBe('Payments');
    expect(canTriage(result, {})).toBe(false);
  });
  it('rejects API failures and malformed decisions rather than showing fake reroutes', async () => {
    const item = seedErrors()[1];
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(triageIssue(item, 'demo', failed)).rejects.toThrow('HTTP 429');
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"team":"Payments"}'));
    await expect(triageIssue(item, 'live', malformed)).rejects.toThrow();
    expect(item.team).toBe('Cart');
    expect(canTriage({ ...item, triageState: 'failed' }, {})).toBe(true);
  });
  it('restores only validated completed decisions for the same static event', async () => {
    const item = seedErrors()[1];
    const result = applyDecision(item, await evaluate(item.envelope, 'demo'));
    const restored = restoreIssues(JSON.stringify([result]));
    expect(restored[1]).toEqual(result);
    expect(restored[0].triageState).toBe('pending');
    const stale = { ...result, envelope: { ...result.envelope, errorMessage: 'stale fixture' } };
    expect(restoreIssues(JSON.stringify([stale]))[1].triageState).toBe('pending');
    expect(restoreIssues('invalid')).toEqual(seedErrors());
  });
});

describe('human review alongside automated triage', () => {
  it('reroutes without changing the host or original Jev evidence', async () => {
    const seed = seedErrors()[1];
    const incident = applyDecision(seed, await evaluate(seed.envelope, 'demo'));
    const original = structuredClone(incident);
    const history = recordReview(incident, {}, 'Cart', '  Host contract problem  ');
    expect(currentAssignment(incident, history)).toBe('Cart');
    expect(history[incident.id][0]).toMatchObject({ fromTeam: 'Payments', toTeam: 'Cart', note: 'Host contract problem' });
    expect(incident).toEqual(original);
    expect(isRerouted(incident, history)).toBe(false);
    expect(forHost([incident], 'Cart')).toContain(incident);
    expect(forHost([incident], 'Payments')).not.toContain(incident);
  });
  it('does not overwrite human-reviewed assignments during a triage run', () => {
    const incident = seedErrors()[1];
    const history = recordReview(incident, {}, 'Payments', 'Ownership correction');
    expect(canTriage(incident, history)).toBe(false);
    expect(currentAssignment(incident, history)).toBe('Payments');
    expect(isRerouted(incident, history)).toBe(true);
    const next = recordReview(incident, history, 'Payments', 'Confirmed');
    expect(history[incident.id]).toHaveLength(1);
    expect(next[incident.id]).toHaveLength(2);
    expect(reviewStatus(incident, next)).toBe('Reviewed');
  });
  it('round trips valid review history and rejects malformed storage', () => {
    const incident = seedErrors()[0];
    const history = recordReview(incident, {}, 'Cart', 'Confirmed');
    expect(parseHistory(JSON.stringify(history))).toEqual(history);
    for (const value of [null, 'broken', '[]', '{"x":[{"toTeam":"unknown"}]}']) expect(parseHistory(value)).toEqual({});
  });
});
