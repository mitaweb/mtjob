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
  updatedBy: string;
  updatedName: string;
}

export interface NoteHistoryEntry {
  id: string;
  noteId: string;
  customer: string;
  content: string;
  color: string;
  savedAt: string;
  savedName: string;
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
    updatedBy: r.updated_by || '',
    updatedName: r.updated_name || '',
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
    `INSERT INTO customer_notes (note_id, customer, content, color, attachments, created_by, created_name, created_at, updated_at, updated_by, updated_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (note_id) DO UPDATE SET
       customer = EXCLUDED.customer, content = EXCLUDED.content, color = EXCLUDED.color,
       attachments = EXCLUDED.attachments, updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by, updated_name = EXCLUDED.updated_name`,
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
      n.updatedBy,
      n.updatedName,
    ],
  );
}

export async function deleteNote(id: string): Promise<void> {
  await q('DELETE FROM customer_notes WHERE note_id = $1', [id]);
}

// ── Lịch sử phiên bản ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToHistory(r: any): NoteHistoryEntry {
  return {
    id: r.hist_id || '',
    noteId: r.note_id || '',
    customer: r.customer || '',
    content: r.content || '',
    color: r.color || '',
    savedAt: r.saved_at || '',
    savedName: r.saved_name || '',
  };
}

const HISTORY_KEEP = 30; // giữ tối đa 30 bản/note — đủ dùng, không phình DB

/** Chụp 1 bản cũ của note vào lịch sử; tự cắt bớt bản quá cũ. */
export async function addHistory(h: NoteHistoryEntry): Promise<void> {
  await q(
    `INSERT INTO customer_note_history (hist_id, note_id, customer, content, color, saved_at, saved_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [h.id, h.noteId, h.customer, h.content, h.color, h.savedAt, h.savedName],
  );
  await q(
    `DELETE FROM customer_note_history WHERE note_id = $1 AND hist_id NOT IN (
       SELECT hist_id FROM customer_note_history WHERE note_id = $1 ORDER BY saved_at DESC LIMIT ${HISTORY_KEEP}
     )`,
    [h.noteId],
  );
}

export async function getHistory(noteId: string): Promise<NoteHistoryEntry[]> {
  return (
    await q('SELECT * FROM customer_note_history WHERE note_id = $1 ORDER BY saved_at DESC', [noteId])
  ).map(rowToHistory);
}

export async function deleteHistory(noteId: string): Promise<void> {
  await q('DELETE FROM customer_note_history WHERE note_id = $1', [noteId]);
}
