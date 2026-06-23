import { q } from '../db/client.js';

export type AttachmentKind = 'image' | 'pdf' | 'video';

export interface Attachment {
  kind: AttachmentKind;
  url: string;
  name: string;
}

export interface CustomerNote {
  id: string;
  customer: string;
  content: string;
  color: string;
  attachments: Attachment[];
  createdBy: string;
  createdName: string;
  createdAt: string;
  updatedAt: string;
}

function parseAttachments(raw: unknown): Attachment[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(String(raw));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a) => a && typeof a.url === 'string')
      .map((a) => ({ kind: a.kind, url: a.url, name: a.name || '' }));
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToNote(r: any): CustomerNote {
  return {
    id: r.note_id || '',
    customer: r.customer || '',
    content: r.content || '',
    color: r.color || '',
    attachments: parseAttachments(r.attachments),
    createdBy: r.created_by || '',
    createdName: r.created_name || '',
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
  };
}

export async function getNotes(): Promise<CustomerNote[]> {
  return (await q('SELECT * FROM customer_notes ORDER BY updated_at DESC')).map(rowToNote);
}

export async function findNote(id: string): Promise<CustomerNote | undefined> {
  const r = await q('SELECT * FROM customer_notes WHERE note_id = $1 LIMIT 1', [id]);
  return r.length ? rowToNote(r[0]) : undefined;
}

export async function upsertNote(n: CustomerNote): Promise<void> {
  await q(
    `INSERT INTO customer_notes (note_id, customer, content, color, attachments, created_by, created_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (note_id) DO UPDATE SET
       customer = EXCLUDED.customer, content = EXCLUDED.content, color = EXCLUDED.color,
       attachments = EXCLUDED.attachments, updated_at = EXCLUDED.updated_at`,
    [
      n.id,
      n.customer,
      n.content,
      n.color,
      JSON.stringify(n.attachments || []),
      n.createdBy,
      n.createdName,
      n.createdAt,
      n.updatedAt,
    ],
  );
}

export async function deleteNote(id: string): Promise<void> {
  await q('DELETE FROM customer_notes WHERE note_id = $1', [id]);
}
