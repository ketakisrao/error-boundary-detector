import { z } from 'zod';
import { answersSchema, envelopeSchema, hostTeam, teams, type Decision, type Team } from '../shared/triage';
import errorFixtures from './data/errors.json';

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
export const reviewStorageKey = 'faultline-reviews-v2';

export function parseHistory(value: string | null): ReviewHistory {
  if (!value) return {};
  try { return historySchema.parse(JSON.parse(value)); } catch { return {}; }
}
export function currentAssignment(incident: Decision, history: ReviewHistory): Decision['team'] {
  return history[incident.id]?.at(-1)?.toTeam ?? incident.team;
}
export function reviewStatus(incident: Decision & { triageState?: Issue['triageState'] }, history: ReviewHistory) {
  const latest = history[incident.id]?.at(-1);
  if (latest) return latest.fromTeam === latest.toTeam ? 'Reviewed' : 'Rerouted';
  if (incident.triageState === 'running') return 'Analyzing';
  if (incident.triageState === 'pending') return 'Awaiting triage';
  if (incident.triageState === 'failed' || incident.status === 'Needs review') return 'Needs review';
  return isRerouted(incident, history) ? 'Rerouted' : 'Kept with host';
}
export function recordReview(incident: Decision, history: ReviewHistory, toTeam: Team, note: string): ReviewHistory {
  const review = reviewSchema.parse({ fromTeam: currentAssignment(incident, history), toTeam, note: note.trim(), timestamp: new Date().toISOString() });
  return { ...history, [incident.id]: [...(history[incident.id] ?? []), review].slice(-100) };
}
export function forHost<T extends Decision>(incidents: T[], team: Team): T[] {
  // A reassignment changes responsibility, not the page where the crash occurred.
  return incidents.filter(item => hostTeam(item.envelope.hostRoute) === team);
}

export interface Issue extends Decision { triageState: 'pending' | 'running' | 'complete' | 'failed' }
export const decisionStorageKey = 'faultline-decisions-v2';
const fixtures = z.array(z.object({ id: z.string(), envelope: envelopeSchema })).parse(errorFixtures);

export function seedErrors(): Issue[] {
  return fixtures.map(({ id, envelope }) => ({
    id, envelope, timestamp: envelope.timestamp, team: hostTeam(envelope.hostRoute)!,
    mode: 'demo', model: 'Not evaluated', answers: null, latencyMs: 0,
    status: 'Routed', severity: 'Unknown', triageState: 'pending',
    reason: `Initially assigned to ${hostTeam(envelope.hostRoute)} from the host route. Not yet evaluated.`,
  }));
}
export function isRerouted(incident: Decision, history: ReviewHistory): boolean {
  const assigned = currentAssignment(incident, history);
  return assigned !== 'Needs review' && assigned !== hostTeam(incident.envelope.hostRoute);
}
export function canTriage(incident: Issue, history: ReviewHistory) {
  return !history[incident.id]?.length && (incident.triageState === 'pending' || incident.triageState === 'failed');
}

const decisionSchema = z.object({
  id: z.string(), timestamp: z.string().datetime(), envelope: envelopeSchema,
  mode: z.enum(['demo', 'live']), model: z.string(), answers: answersSchema.nullable(),
  team: z.union([z.enum(teams), z.literal('Needs review')]), status: z.enum(['Routed', 'Needs review']),
  severity: z.enum(['Critical', 'High', 'Medium', 'Unknown']), latencyMs: z.number().finite().nonnegative(), reason: z.string(),
});
export function applyDecision(incident: Issue, payload: unknown): Issue {
  const decision = decisionSchema.parse(payload);
  // Preserve the event identity, capture time and original JSON envelope.
  return { ...decision, id: incident.id, timestamp: incident.timestamp, envelope: incident.envelope, triageState: 'complete' };
}
export function restoreIssues(value: string | null): Issue[] {
  const initial = seedErrors();
  try {
    const saved = z.array(decisionSchema).parse(JSON.parse(value ?? '[]'));
    return initial.map(incident => {
      const prior = saved.find(item => item.id === incident.id && JSON.stringify(item.envelope) === JSON.stringify(incident.envelope));
      return prior ? applyDecision(incident, prior) : incident;
    });
  } catch { return initial; }
}
export async function triageIssue(incident: Issue, mode: Decision['mode'], fetcher: typeof fetch = fetch): Promise<Issue> {
  const response = await fetcher('/api/triage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ mode, envelope: incident.envelope }),
  });
  if (!response.ok) throw new Error(`Triage request failed (HTTP ${response.status}). Retry or review this issue.`);
  return applyDecision(incident, await response.json());
}
