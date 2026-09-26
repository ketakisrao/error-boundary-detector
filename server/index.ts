import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { envelopeSchema } from '../shared/triage';
import { evaluate } from './engine';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', liveAvailable: Boolean(process.env.TYPESAFE_API_KEY) }));
// Bound provider usage in this single-process demo. Use authenticated, distributed limits before deployment.
let active = 0;
let windowStart = Date.now();
let calls = 0;
app.post('/api/triage', async (req, res) => {
  const input = z.object({ envelope: envelopeSchema, mode: z.enum(['demo', 'live']) }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'Invalid error context envelope.' }); return; }
  if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); calls = 0; }
  if (active >= 8 || calls >= 120) { res.status(429).json({ error: 'Triage is busy. Please retry shortly.' }); return; }
  calls++; active++;
  try {
    const result = await evaluate(input.data.envelope, input.data.mode, { key: process.env.TYPESAFE_API_KEY, endpoint: process.env.TYPESAFE_ENDPOINT });
    res.json(result);
  } finally { active--; }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status === 413 ? 413 : 400).json({ error: 'The request could not be processed.' });
});
app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('Faultline is ready on port ' + (process.env.PORT ?? 3000)));
