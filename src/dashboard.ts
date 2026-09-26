import { z } from 'zod';
import { fixtureAnswers, hostTeam, routeDecision, scenarioEnvelope, scenarios, teams, type Decision, type Team } from '../shared/triage';

export const hostPages = [
  { team: 'Cart', route: '/cart' },
  { team: 'Vendors', route: '/vendors' },
  { team: 'Payments', route: '/checkout' },
] as const;

const reviewSchema = z.object({
  fromTeam: z.union([z.enum(teams), z.literal('Needs review')]),
  toTeam: z.enum(teams), note: z.string().max(500), timestamp: z.string().datetime(),
});
const historySchema = z.record(z.array(reviewSchema).max(100));
export type Review = z.infer<typeof reviewSchema>;
export type ReviewHistory = Record<string, Review[]>;
export const reviewStorageKey = 'faultline-reviews-v1';

export function parseHistory(value: string | null): ReviewHistory {
  if (!value) return {};
  try { return historySchema.parse(JSON.parse(value)); } catch { return {}; }
}
export function currentAssignment(incident: Decision, history: ReviewHistory): Decision['team'] {
  return history[incident.id]?.at(-1)?.toTeam ?? incident.team;
}
export function reviewStatus(incident: Decision, history: ReviewHistory) {
  const latest = history[incident.id]?.at(-1);
  if (latest) return latest.fromTeam === latest.toTeam ? 'Reviewed' : 'Rerouted';
  return incident.status === 'Needs review' ? 'Needs review' : 'Auto-assigned';
}
export function recordReview(incident: Decision, history: ReviewHistory, toTeam: Team, note: string): ReviewHistory {
  const review = reviewSchema.parse({ fromTeam: currentAssignment(incident, history), toTeam, note: note.trim(), timestamp: new Date().toISOString() });
  return { ...history, [incident.id]: [...(history[incident.id] ?? []), review].slice(-100) };
}
export function forHost(incidents: Decision[], team: Team): Decision[] {
  // A reassignment changes responsibility, not the page where the crash occurred.
  return incidents.filter(item => hostTeam(item.envelope.hostRoute) === team);
}

export function seedErrors(): Decision[] {
  const files: Record<string, string> = {
    'credit-card-banner': 'components/payments/CreditCardBanner.tsx',
    'des-button': 'components/design-system/DesButton.tsx',
    'des-select': 'components/design-system/DesSelect.tsx',
    'remote-widget': 'components/remote/RemoteWidget.tsx',
  };
  return hostPages.flatMap(({ team, route }, pageIndex) => {
    const pattern = pageIndex === 0 ? [0, 2, 4, 3, 0, 1, 2, 0, 4, 3, 0, 2] : pageIndex === 1 ? [0, 2, 1, 3, 4, 0, 2] : [0, 2, 3, 4];
    return pattern.map((scenarioIndex, index) => {
      const scenario = scenarios[scenarioIndex];
      const envelope = scenarioEnvelope(scenario, route);
      // Seed events are labeled sample data. Actual boundary captures retain React's frames.
      envelope.componentStack = [
        `at ${scenario.component} (src/${files[scenario.component]}:5:9)`,
        `at ${team}Page (src/pages/${team}Page.tsx:24:5)`, 'at main', 'at App (src/App.tsx:18:7)',
      ];
      let answers = fixtureAnswers(scenario, route);
      let routing = routeDecision(answers, envelope);
      if (pageIndex === 0 && index === 0) {
        // A labeled, deliberately wrong sample for demonstrating human correction.
        answers = { ...answers, owner: { ...answers.owner, choice: 'Cart', confidence: .78,
          probabilities: Object.fromEntries(teams.map(owner => [owner, owner === 'Cart' ? .91 : .09 / (teams.length - 1)])) } };
        routing = { team: 'Cart', reason: 'Demo misclassification: the host was selected even though credit-card-banner belongs to Payments.' };
      }
      const timestamp = new Date(Date.now() - (index * 7 + 2) * 60_000).toISOString();
      envelope.timestamp = timestamp;
      return {
        id: `FL-${pageIndex + 1}${String(248 - index).padStart(3, '0')}`, timestamp, envelope, answers, ...routing,
        mode: 'demo', model: 'Illustrative Jev decision', latencyMs: 118,
        status: routing.team === 'Needs review' ? 'Needs review' : 'Routed',
        severity: answers.severity.score >= 1.5 ? 'High' : 'Medium',
      } satisfies Decision;
    });
  });
}
