import { describe, expect, it } from 'vitest';
import { fixtureAnswers, routeDecision, scenarioEnvelope, scenarios, type Decision } from '../shared/triage';
import { outcomeOf, routingSummary } from '../src/routing';

function incident(index: number, route = '/vendors'): Decision {
  const envelope = scenarioEnvelope(scenarios[index], route);
  const answers = fixtureAnswers(scenarios[index], route);
  const routing = routeDecision(answers, envelope);
  return { id: crypto.randomUUID(), timestamp: envelope.timestamp, envelope, answers, ...routing,
    status: routing.team === 'Needs review' ? 'Needs review' : 'Routed', mode: 'demo', model: 'test fixture', latencyMs: 1, severity: 'High' };
}

describe('routing journal counts', () => {
  it('counts only cross-team dispatches as reroutes and groups by actual source and destination', () => {
    const summary = routingSummary([0, 2, 1, 0, 3, 4, 0].map(index => incident(index)));
    expect(summary).toEqual({ rerouted: 5, retained: 1, review: 1, assigned: 0,
      pairs: [{ from: 'Vendors', to: 'Payments', count: 3 }, { from: 'Vendors', to: 'Platform', count: 2 }] });
  });
  it('does not treat a payment error on a Payments host as a reroute', () => {
    expect(outcomeOf(incident(0, '/checkout'))).toBe('retained');
  });
  it('excludes unknown sources and reviews even if they have an owner prediction', () => {
    const ambiguous = { ...incident(0), status: 'Needs review' as const };
    const summary = routingSummary([incident(0, '/unknown'), ambiguous]);
    expect(summary.rerouted).toBe(0);
    expect(summary.assigned).toBe(1);
    expect(summary.review).toBe(1);
    expect(summary.pairs).toEqual([]);
  });
  it('updates the correct pair when another incident arrives', () => {
    const summary = routingSummary([incident(0), incident(0), incident(2, '/checkout')]);
    expect(summary.pairs).toEqual([{ from: 'Vendors', to: 'Payments', count: 2 }, { from: 'Payments', to: 'Platform', count: 1 }]);
    expect(summary.rerouted).toBe(3);
  });
  it('handles an empty journal', () => {
    expect(routingSummary([])).toEqual({ rerouted: 0, retained: 0, review: 0, assigned: 0, pairs: [] });
  });
});
