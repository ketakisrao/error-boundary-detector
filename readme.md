# Faultline

An interactive React error-boundary triage demo with a server-side TypeSafe Jev adapter. A captured crash is evaluated through **Choice** (owner), **Noul** (host contract), and **Score** (operational blast radius).

## Run

Requires Node 24 and npm 11.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. `npm run build` typechecks and creates production assets; `npm start` serves them. `npm test` verifies attribution gates and upstream failure paths.

## Demo and live evaluations

The dashboard loads static error context envelopes from `src/data/errors.json`: 12 errors on `/cart`, four on `/vendors`, and two on `/checkout`. Error messages, full React-style component frames, call stacks, sanitized props and capture timestamps live in that file. These are synthetic examples. Every issue initially belongs to its host team, with no precomputed ownership answer or latency.

Click **Run Jev triage** to submit each issue on the selected page to `/api/triage`. The UI shows the active component, then updates its assignment and measured server processing time. Cart's default fixtures produce six retained Cart faults (five native Cart components and one invalid host prop contract) and six reroutes: Payments ×2, Platform ×2, Vendors ×1, Tax & Compliance ×1. All issues remain open. The reroute count and filter highlight issues that left the host team's queue.

Server health selects **Live Jev** when a key is configured, otherwise a clearly labeled **Demo engine**. The demo computes ownership from component and contract evidence; its probabilities are illustrative. Times come from the API's `latencyMs`, not fixtures. The walkthrough paces row updates by 220 ms for visibility; reported times exclude that pacing and browser/network time. Failed requests stay with their current team, become **Needs review**, and can be retried. Provider failures never silently use demo answers.

Open **Review** to inspect the full stack, original decision and confidence, confirm an assignment or choose another team. Human-reviewed assignments are excluded from subsequent automatic runs. Decisions and review history survive refresh in this tab's `sessionStorage`; closing the session clears them. The reset icon restores only the selected page's sample issues and clears its review history, so the walkthrough can be repeated. No external alerts are dispatched.

To enable real Jev requests, export a server-side key and restart:

```sh
export TYPESAFE_API_KEY='your-key'
npm run dev
```

The dashboard will show **Live Jev** and send the static envelopes with `mode: "live"` when you run triage. You can also submit envelopes directly to `POST /api/triage`. The reusable `ErrorCapture` component retains real React stack capture for application integration. `.env.example` documents configuration; environment files are not automatically loaded. `TYPESAFE_ENDPOINT` optionally overrides the API URL for local testing. Never put keys in frontend/Vite variables.

The adapter follows https://docs.typesafe.ai/api and sends all three questions in one request to `https://api.typesafe.ai/v1/systemone`, using `jev-latest`. Live provider failure never falls back to fixtures.

## Ownership evidence

`hostRoute` records where the component was embedded and the team that initially received the alert. It does not determine the owner of an embedded component. The dashboard includes `/cart`, `/vendors`, and `/checkout` host pages.

The trusted registry has exact component ownership (`credit-card-banner` → Payments) and namespace rules (`des-*` → Platform / Design Systems). The first React boundary stack frame identifies the throwing component. A known ancestor does not establish ownership of an unknown child. Live Jev receives the envelope, registry and explicit instructions to use these rules; high-confidence contradictions or missing ownership evidence are held for review. Contract violations remain a separate reason to retain responsibility with the host.

## Routing policy

- Require ≥85% ownership probability and ≥75% Choice confidence.
- Require a decisive contract result: ≥85% upheld or ≤15% upheld.
- A violated host contract must agree with the trusted host owner.
- Require ≥60% severity confidence.
- Abort upstream work after 180 ms; evaluations at or above 200 ms go to review.
- Timeouts, missing credentials, malformed probabilities, inconsistent answers, and ambiguous evidence go to **Needs review**.

The 200 ms number is a target and routing budget, not a live latency guarantee. The API reports measured server evaluation latency, excluding browser network/rendering time. Validate latency and calibration against your environment and labeled incidents before deployment.

## Dashboard and appearance

A compact host selector and error table provide the main view. Filter by review status or search components, messages, teams and event IDs. A side panel holds stack details and manual reassignment. Light and dark modes use neutral surfaces with one muted violet accent; the saved preference falls back to the OS theme.

## Integration boundary

`shared/triage.ts` contains the requested TypeScript envelope, runtime validation, trusted ownership/contract registry, and routing policy. `server/engine.ts` contains the Jev adapter. `src/ErrorCapture.tsx` demonstrates a real React boundary. `sanitizeProps` retains structural types and nulls, discarding prop values. Initial source frames and all demo props are synthetic. Triggered examples render named React components in separate source files (`credit-card-banner`, `des-button`, `des-select`). The error boundary retains the full React `componentStack` frames, including source locations when React provides them. The live Jev request receives that same frame array; only ownership lookup extracts the first component name. Production integrations must preserve/map component names (including display names through minification) and capture sanitized props at the embedding boundary. Scrub error messages, stack URLs, and identifiers according to your telemetry policy before transmission.

**This is a local interactive demo, not a production alerting service.** Sample events are loaded from static JSON. Manual reviews survive refresh in the current browser tab; closing the session clears them. External Slack/PagerDuty dispatch, server persistence, source-map resolution, production identity/authentication, tenant isolation, and fleet-wide deduplication are not included. The API has bounded payloads, concurrency and a per-process request cap; add authentication and distributed rate limiting before public deployment. Never send sensitive production telemetry to the demo.

## API

`GET /api/health` returns service health and whether a server key is configured (not proof that the provider accepts the key).

`POST /api/triage` accepts `{ "mode": "demo" | "live", "envelope": ErrorContextEnvelope }`, returning a typed `Decision`. Invalid requests return 400; overload returns 429. Provider failures return a review decision so the client can retain the incident.
