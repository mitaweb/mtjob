import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import {
  getCustomers,
  findCustomer,
  upsertCustomer,
  deleteCustomer,
  getAppointments,
  getUpcoming,
  addAppointment,
  setAppointmentDone,
  deleteAppointment,
  CLOSED_STATUS,
  type Customer,
} from './crm.repo.js';
import { getActiveMembers } from './members.repo.js';
import { newId } from '../util/id.js';
import { nowTz, toIsoVn } from '../lib/datetime.js';
import { ingestInBackground, removeSource, markCustomerDirty } from './brain.service.js';

export const crmRouter = Router();
crmRouter.use(requireAuth, requireRole('sale', 'director', 'admin'));

crmRouter.get(
  '/customers',
  asyncHandler(async (_req, res) => {
    res.json({ customers: await getCustomers() });
  }),
);

const customerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  phone: z.string().optional().default(''),
  status: z.string().optional().default('Mới'),
  note: z.string().optional().default(''),
  info: z.string().optional().default(''),
  assignedTo: z.string().optional().default(''),
  dob: z.string().optional().default(''),
  closedAt: z.string().optional().default(''),
});

crmRouter.post(
  '/customers',
  asyncHandler(async (req, res) => {
    const b = customerSchema.parse(req.body);
    const existing = b.id ? await findCustomer(b.id) : undefined;
    const c: Customer = {
      id: existing?.id || b.id || newId('C-'),
      name: b.name,
      phone: b.phone,
      status: b.status,
      note: b.note,
      info: b.info,
      assignedTo: b.assignedTo,
      dob: b.dob,
      // Tự ghi mốc chốt lần đầu chuyển sang "Đã chốt" — dùng để nhắc tái tục.
      closedAt:
        b.closedAt ||
        (b.status === CLOSED_STATUS && existing?.status !== CLOSED_STATUS
          ? nowTz().format('YYYY-MM-DD')
          : existing?.closedAt || ''),
      createdAt: existing?.createdAt || nowTz().toISOString(),
    };
    await upsertCustomer(c);
    // Nạp vào kho tri thức — KHÔNG kèm số điện thoại (nhân viên tra được kho; SĐT chỉ giám đốc xem).
    ingestInBackground({
      sourceType: 'customer',
      sourceId: c.id,
      title: `Hồ sơ khách hàng: ${c.name}`,
      text: [
        `Khách hàng: ${c.name}`,
        c.status ? `Tình trạng: ${c.status}` : '',
        c.info ? `Thông tin: ${c.info}` : '',
        c.note ? `Ghi chú: ${c.note}` : '',
      ].filter(Boolean).join('\n'),
      visibility: 'all',
      customer: c.name,
    });
    res.json({ ok: true, id: c.id });
  }),
);

crmRouter.delete(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const gone = await findCustomer(String(req.params.id));
    await deleteCustomer(String(req.params.id));
    await removeSource('customer', String(req.params.id));
    // Lưu ý KH có thể vẫn nhắc tới khách này → dựng lại hồ sơ thay vì xoá thẳng.
    if (gone?.name) markCustomerDirty(gone.name);
    res.json({ ok: true });
  }),
);

crmRouter.get(
  '/customers/:id/appointments',
  asyncHandler(async (req, res) => {
    res.json({ appointments: await getAppointments(String(req.params.id)) });
  }),
);

crmRouter.get(
  '/appointments/upcoming',
  asyncHandler(async (_req, res) => {
    const from = nowTz().startOf('day').toISOString();
    const to = nowTz().add(14, 'day').endOf('day').toISOString();
    res.json({ appointments: await getUpcoming(from, to) });
  }),
);

const apptSchema = z.object({
  customerId: z.string().min(1),
  at: z.string().min(1), // ISO datetime
  note: z.string().optional().default(''),
  ownerId: z.string().optional().default(''),
});

crmRouter.post(
  '/appointments',
  asyncHandler(async (req, res) => {
    const b = apptSchema.parse(req.body);
    const customer = await findCustomer(b.customerId);
    if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
    const id = newId('A-');
    await addAppointment({
      id,
      customerId: customer.id,
      customerName: customer.name,
      at: toIsoVn(b.at),
      note: b.note,
      ownerId: b.ownerId || customer.assignedTo || req.user!.sub,
      done: false,
    });
    if (b.note.trim()) {
      ingestInBackground({
        sourceType: 'appointment',
        sourceId: id,
        title: `Lịch hẹn: ${customer.name}`,
        text: `Hẹn ${customer.name} lúc ${toIsoVn(b.at).slice(0, 16).replace('T', ' ')}: ${b.note}`,
        visibility: 'all',
        customer: customer.name,
      });
    }
    res.json({ ok: true, id });
  }),
);

crmRouter.post(
  '/appointments/:id/done',
  asyncHandler(async (req, res) => {
    const done = req.body?.done !== false;
    await setAppointmentDone(String(req.params.id), done);
    res.json({ ok: true });
  }),
);

crmRouter.delete(
  '/appointments/:id',
  asyncHandler(async (req, res) => {
    await deleteAppointment(String(req.params.id));
    await removeSource('appointment', String(req.params.id));
    res.json({ ok: true });
  }),
);

// Danh sách thành viên để gán phụ trách / chủ lịch hẹn.
crmRouter.get(
  '/members',
  asyncHandler(async (_req, res) => {
    const members = await getActiveMembers();
    res.json({ members: members.map((m) => ({ id: m.id, fullName: m.fullName, role: m.role })) });
  }),
);
