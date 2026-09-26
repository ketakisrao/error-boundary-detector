import { hostTeam, type Decision, type Team } from '../shared/triage';

export type Outcome = 'rerouted' | 'retained' | 'review' | 'assigned';
export type RoutingPair = { from: Team; to: Team; count: number };

export function outcomeOf(incident: Decision): Outcome {
  if (incident.status === 'Needs review' || incident.team === 'Needs review') return 'review';
  const source = hostTeam(incident.envelope.hostRoute);
  if (!source) return 'assigned';
  return source === incident.team ? 'retained' : 'rerouted';
}

export function routingSummary(incidents: Decision[]) {
  const counts = { rerouted: 0, retained: 0, review: 0, assigned: 0 };
  const pairs = new Map<string, RoutingPair>();
  for (const incident of incidents) {
    const outcome = outcomeOf(incident);
    counts[outcome]++;
    if (outcome !== 'rerouted') continue;
    const from = hostTeam(incident.envelope.hostRoute)!;
    const to = incident.team as Team;
    const key = `${from}:${to}`;
    const pair = pairs.get(key) ?? { from, to, count: 0 };
    pair.count++;
    pairs.set(key, pair);
  }
  return { ...counts, pairs: [...pairs.values()].sort((a, b) => b.count - a.count || a.to.localeCompare(b.to)) };
}
