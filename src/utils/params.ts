import type { Request } from 'express';

/** Express 5 types req.params values as `string | string[]` — route params are never arrays. */
export function getParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new Error(`Expected route param "${name}" to be a string`);
  }
  return value;
}
