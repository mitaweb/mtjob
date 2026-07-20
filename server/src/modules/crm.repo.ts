import { q } from '../db/client.js';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  status: string;
  note: string;
  info: string;
  assignedTo: string;
  dob: string; // ngày sinh khách (YYYY-MM-DD hoặc --MM-DD nếu không rõ năm)
  closedAt: string; // ngày chốt hợp đồng — mốc tính tái tục
  createdAt: string;
}

/** Khách đã chốt hợp đồng (cần hậu mãi/tái tục) hay còn tiềm năng (cần chốt)? */
export const CLOSED_STATUS = 'Đã chốt';

export interface Appointment {
  id: string;
  customerId: string;
  customerName: string;
  at: string; // ISO datetime
  note: string;
  ownerId: string;
  done: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCustomer(r: any): Customer {
  return {
    id: r.customer_id || '',
    name: r.name || '',
    phone: r.phone || '',
    status: r.status || '',
    note: r.note || '',
    info: r.info || '',
    assignedTo: r.assigned_to || '',
    dob: r.dob || '',
    closedAt: r.closed_at || '',
    createdAt: r.created_at || '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAppt(r: any): Appointment {
  return {
    id: r.appt_id || '',
    customerId: r.customer_id || '',
    customerName: r.customer_name || '',
    at: r.at || '',
    note: r.note || '',
    ownerId: r.owner_id || '',
    done: !!r.done,
  };
}

export async function getCustomers(): Promise<Customer[]> {
  return (await q('SELECT * FROM customers ORDER BY created_at DESC')).map(rowToCustomer);
}

export async function findCustomer(id: string): Promise<Customer | undefined> {
  const r = await q('SELECT * FROM customers WHERE customer_id = $1 LIMIT 1', [id]);
  return r.length ? rowToCustomer(r[0]) : undefined;
}

export async function upsertCustomer(c: Customer): Promise<void> {
  await q(
    `INSERT INTO customers (customer_id, name, phone, status, note, info, assigned_to, dob, closed_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (customer_id) DO UPDATE SET
       name = EXCLUDED.name, phone = EXCLUDED.phone, status = EXCLUDED.status,
       note = EXCLUDED.note, info = EXCLUDED.info, assigned_to = EXCLUDED.assigned_to,
       dob = EXCLUDED.dob, closed_at = EXCLUDED.closed_at`,
    [
      c.id, c.name, c.phone, c.status, c.note, c.info, c.assignedTo,
      c.dob || '', c.closedAt || '', c.createdAt || new Date().toISOString(),
    ],
  );
}

export async function deleteCustomer(id: string): Promise<void> {
  await q('DELETE FROM customers WHERE customer_id = $1', [id]);
  await q('DELETE FROM appointments WHERE customer_id = $1', [id]);
}

export async function getAppointments(customerId?: string): Promise<Appointment[]> {
  const rows = customerId
    ? await q('SELECT * FROM appointments WHERE customer_id = $1 ORDER BY at', [customerId])
    : await q('SELECT * FROM appointments ORDER BY at');
  return rows.map(rowToAppt);
}

/** Lịch hẹn chưa xong trong khoảng [fromIso, toIso). */
export async function getUpcoming(fromIso: string, toIso: string): Promise<Appointment[]> {
  return (
    await q('SELECT * FROM appointments WHERE done = false AND at >= $1 AND at < $2 ORDER BY at', [fromIso, toIso])
  ).map(rowToAppt);
}

export async function addAppointment(a: Appointment): Promise<void> {
  await q(
    `INSERT INTO appointments (appt_id, customer_id, customer_name, at, note, owner_id, done, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.id, a.customerId, a.customerName, a.at, a.note, a.ownerId, a.done, new Date().toISOString()],
  );
}

export async function setAppointmentDone(id: string, done: boolean): Promise<void> {
  await q('UPDATE appointments SET done = $1 WHERE appt_id = $2', [done, id]);
}

export async function deleteAppointment(id: string): Promise<void> {
  await q('DELETE FROM appointments WHERE appt_id = $1', [id]);
}
