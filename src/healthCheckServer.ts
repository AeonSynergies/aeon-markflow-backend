import http, { type Server } from 'http';
import { type AddressInfo } from 'net';
import { env } from './config/env';

/**
 * A minimal HTTP server with a single `/health` route, returning the same
 * `{ status: 'ok' }` shape as the API server's own `GET /health` (src/app.ts).
 *
 * The BullMQ worker process (src/worker.ts) does no HTTP work of its own — this exists solely
 * so App Runner's request-driven health check has something to respond to when the worker is
 * deployed as its own App Runner service (see apprunner-worker.yaml). It runs alongside the
 * real worker/scheduler logic, never in place of it.
 */
export function startHealthCheckServer(port: number = env.port): Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Worker health-check server listening on port ${(server.address() as AddressInfo).port}`);
  });

  return server;
}
