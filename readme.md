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

The dashboard opens on Cart with 12 labeled sample events. The host selector also offers Vendors and Payments. Each row shows the first component in the React component stack, its page, assigned team, original Jev confidence and review status. The first Cart event is deliberately misclassified to demonstrate a human correction. Sample decisions and stacks are illustrative, not measured Jev inference or calibration.

Open **Review** to inspect the full stack and original decision, confirm an assignment or choose another team. Reviews include an optional note and chronological history. Assignments stay associated with the page where the error occurred. Manual review history is stored in this tab's `sessionStorage` and survives refresh; it does not dispatch external alerts. The original model decision is retained separately.

To enable real Jev requests, export a server-side key and restart:

```sh
export TYPESAFE_API_KEY='your-key'
npm run dev
```

Submit envelopes to `POST /api/triage` with `mode: "live"`; the dashboard currently displays sample events. The reusable `ErrorCapture` component retains real React stack capture for application integration. `.env.example` documents configuration; environment files are not automatically loaded. `TYPESAFE_ENDPOINT` optionally overrides the API URL for local testing. Never put keys in frontend/Vite variables.

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

**This is a local interactive demo, not a production alerting service.** Sample events are generated locally. Manual reviews survive refresh in the current browser tab; closing the session clears them. External Slack/PagerDuty dispatch, persistence, source-map resolution, production identity/authentication, tenant isolation, and fleet-wide deduplication are not included. The API has bounded payloads, concurrency and a per-process request cap; add authentication and distributed rate limiting before public deployment. Never send sensitive production telemetry to the demo.

## API

`GET /api/health` returns service health and whether a server key is configured (not proof that the provider accepts the key).

`POST /api/triage` accepts `{ "mode": "demo" | "live", "envelope": ErrorContextEnvelope }`, returning a typed `Decision`. Invalid requests return 400; overload returns 429. Provider failures return a review decision so the client can retain the incident.
