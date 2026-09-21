import http, { type Server } from 'http';
import { type AddressInfo } from 'net';
import { startHealthCheckServer } from '../src/healthCheckServer';

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

// Port 0 lets the OS assign a free ephemeral port; `listen` is async, so wait for `listening`
// before reading the assigned port back off the server.
function listening(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.on('listening', () => resolve((server.address() as AddressInfo).port));
  });
}

describe('healthCheckServer', () => {
  it('responds 200 with {"status":"ok"} on GET /health', async () => {
    const server = startHealthCheckServer(0);
    const port = await listening(server);

    try {
      const { status, body } = await get(port, '/health');
      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ status: 'ok' });
    } finally {
      server.close();
    }
  });

  it('responds 404 for any other route', async () => {
    const server = startHealthCheckServer(0);
    const port = await listening(server);

    try {
      const { status } = await get(port, '/');
      expect(status).toBe(404);
    } finally {
      server.close();
    }
  });
});
