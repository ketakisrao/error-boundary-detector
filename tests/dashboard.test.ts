import { describe, expect, it } from 'vitest';
import { currentAssignment, forHost, parseHistory, recordReview, reviewStatus, seedErrors } from '../src/dashboard';
import { answersSchema, componentName } from '../shared/triage';

describe('host dashboard and human review', () => {
  it('lists crashes by originating page, including embedded components', () => {
    const errors = seedErrors();
    expect(forHost(errors, 'Cart')).toHaveLength(12);
    expect(forHost(errors, 'Vendors')).toHaveLength(7);
    expect(forHost(errors, 'Payments')).toHaveLength(4);
    expect(new Set(errors.map(item => item.id)).size).toBe(errors.length);
    for (const item of errors) expect(answersSchema.safeParse(item.answers).success).toBe(true);
    expect(componentName(errors[0].envelope.componentStack[0])).toBe('credit-card-banner');
    expect(errors[0].team).toBe('Cart'); // Deliberate sample misclassification.
  });
  it('reroutes without changing the host or original Jev evidence', () => {
    const errors = seedErrors();
    const incident = errors[0];
    const original = structuredClone(incident);
    const history = recordReview(incident, {}, 'Payments', '  Owned by Payments  ');
    expect(currentAssignment(incident, history)).toBe('Payments');
    expect(reviewStatus(incident, history)).toBe('Rerouted');
    expect(history[incident.id][0]).toMatchObject({ fromTeam: 'Cart', toTeam: 'Payments', note: 'Owned by Payments' });
    expect(incident).toEqual(original);
    expect(forHost(errors, 'Cart')).toContain(incident);
    expect(forHost(errors, 'Payments')).not.toContain(incident);
  });
  it('confirms an existing assignment and preserves earlier review history', () => {
    const incident = seedErrors()[0];
    const first = recordReview(incident, {}, 'Payments', 'Ownership correction');
    const next = recordReview(incident, first, 'Payments', 'Confirmed');
    expect(first[incident.id]).toHaveLength(1);
    expect(next[incident.id]).toHaveLength(2);
    expect(next[incident.id][1].fromTeam).toBe('Payments');
    expect(reviewStatus(incident, next)).toBe('Reviewed');
  });
  it('resolves a pending event with a human assignment', () => {
    const incident = seedErrors().find(item => item.status === 'Needs review')!;
    expect(reviewStatus(incident, {})).toBe('Needs review');
    const history = recordReview(incident, {}, 'Platform', 'Checked component ownership');
    expect(currentAssignment(incident, history)).toBe('Platform');
    expect(reviewStatus(incident, history)).toBe('Rerouted');
    expect(history[incident.id][0].fromTeam).toBe('Needs review');
  });
  it('round trips valid session history and rejects malformed storage', () => {
    const incident = seedErrors()[0];
    const history = recordReview(incident, {}, 'Payments', 'Confirmed');
    expect(parseHistory(JSON.stringify(history))).toEqual(history);
    for (const value of [null, 'broken', '[]', '{"x":[{"toTeam":"unknown"}]}']) expect(parseHistory(value)).toEqual({});
  });
});
