import { randomUUID } from 'node:crypto';

/** Short, prefixed unique id, e.g. newId('T-') -> 'T-9f3a1c20'. */
export function newId(prefix = ''): string {
  return prefix + randomUUID().replace(/-/g, '').slice(0, 10);
}
