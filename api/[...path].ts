import app, { ensureReady } from '../apps/api/src/index.js';

export default async function handler(request: any, response: any) {
  await ensureReady();
  return app(request, response);
}
