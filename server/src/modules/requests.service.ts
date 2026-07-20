import { ApiError } from '../util/errors.js';
import {
  addRequest,
  findRequest,
  updateRequest,
  type RequestKind,
  type RequestRow,
} from './requests.repo.js';
import { findById, getDirectors } from './members.repo.js';
import { teamLeaderId } from './teams.repo.js';
import { saveAttendance, getMemberDate, deleteAttendance } from './attendance.repo.js';
import { notify } from './notifications.service.js';
import { dayFractionFromShifts } from '../lib/attendance.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import type { AttendanceRow, Member, RequestScope, RequestStatus } from '../types.js';

const kindVi = (k: RequestKind) => (k === 'online' ? 'làm online' : 'nghỉ phép');

async function leaderForMember(member: Member): Promise<string> {
  const lid = await teamLeaderId(member.teamId);
  return lid && lid !== member.id ? lid : '';
}

function recomputeFinal(leader: RequestStatus, director: RequestStatus): RequestStatus {
  if (leader === 'rejected' || director === 'rejected') return 'rejected';
  if (leader === 'approved' && director === 'approved') return 'approved';
  return 'pending';
}

export interface SubmitInput {
  memberId: string;
  kind: RequestKind;
  dates: string[];
  scope?: RequestScope;
  type?: string;
  reason: string;
}

export async function submitRequest(i: SubmitInput): Promise<RequestRow> {
  const member = await findById(i.memberId);
  if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');
  if (i.dates.length === 0) throw new ApiError(400, 'Chưa chọn ngày');

  const leaderId = await leaderForMember(member);
  const now = nowTz().toISOString();
  const row: RequestRow = {
    kind: i.kind,
    id: newId('R-'),
    memberId: member.id,
    name: member.fullName,
    dates: i.dates,
    scope: i.scope,
    type: i.type,
    reason: i.reason,
    // If the member has no distinct leader (e.g. a leader/director themselves),
    // the leader step is auto-approved and it goes straight to the director.
    leaderStatus: leaderId ? 'pending' : 'approved',
    leaderBy: leaderId ? '' : 'auto',
    leaderAt: leaderId ? '' : now,
    directorStatus: 'pending',
    directorBy: '',
    directorAt: '',
    finalStatus: 'pending',
    createdAt: now,
  };
  await addRequest(row);

  if (leaderId) {
    await notify(leaderId, {
      type: 'request',
      title: 'Đơn cần duyệt',
      body: `${member.fullName} xin ${kindVi(i.kind)}: ${i.dates.join(', ')}.`,
      url: '/approvals',
    }, { background: true });
  } else {
    for (const d of await getDirectors()) {
      await notify(d.id, {
        type: 'request',
        title: 'Đơn cần duyệt (cấp giám đốc)',
        body: `${member.fullName} xin ${kindVi(i.kind)}: ${i.dates.join(', ')}.`,
        url: '/approvals',
      }, { background: true });
    }
  }
  return row;
}

async function recordOnlineAttendance(req: RequestRow): Promise<void> {
  const member = await findById(req.memberId);
  if (!member) return;
  // Scope phủ buổi nào: full = cả 2; half_am = sáng; half_pm = chiều.
  const scope = req.scope || 'full';
  const coversMorning = scope !== 'half_pm';
  const coversAfternoon = scope !== 'half_am';

  for (const date of req.dates) {
    // GỘP vào dòng sẵn có thay vì ghi đè: chỉ THÊM buổi online phủ, không xoá
    // buổi đã chấm (tránh đơn nửa ngày đè mất đơn/giờ cả ngày). Công chỉ tăng/giữ.
    const existing = await getMemberDate(member.id, date);
    const row: AttendanceRow = existing ?? {
      date,
      memberId: member.id,
      name: member.fullName,
      morningInAt: '',
      morningOutAt: '',
      afternoonInAt: '',
      afternoonOutAt: '',
      dayFraction: 0,
      mode: 'online',
      status: 'absent',
    };
    row.name = member.fullName;
    if (coversMorning && !row.morningInAt) row.morningInAt = 'online';
    if (coversAfternoon && !row.afternoonInAt) row.afternoonInAt = 'online';
    row.dayFraction = dayFractionFromShifts({
      morningIn: row.morningInAt,
      afternoonIn: row.afternoonInAt,
      afternoonOut: row.afternoonOutAt,
    });
    row.mode = 'online';
    row.status = row.dayFraction >= 1 ? 'present' : 'half';
    row.note = `Làm online (đơn ${req.id})`;
    await saveAttendance(row);
  }
}

async function recordLeave(req: RequestRow): Promise<void> {
  const member = await findById(req.memberId);
  if (!member) return;
  // Leave is stored for the record but does NOT count as a worked day (DayFraction = 0).
  for (const date of req.dates) {
    await saveAttendance({
      date,
      memberId: member.id,
      name: member.fullName,
      dayFraction: 0,
      mode: 'leave',
      status: 'leave',
      note: `Nghỉ phép — đơn ${req.id}`,
    });
  }
}

/** Gỡ ngày công đã ghi từ đơn NGHỈ PHÉP (chỉ xoá dòng do chính đơn này tạo). */
async function undoLeaveAttendance(req: RequestRow): Promise<void> {
  for (const date of req.dates) {
    const row = await getMemberDate(req.memberId, date);
    if (row && row.mode === 'leave' && (row.note || '').includes(req.id)) {
      await deleteAttendance(date, req.memberId);
    }
  }
}

/** Gỡ buổi 'online' đã ghi từ đơn LÀM ONLINE; giữ nguyên buổi chấm công thật (nếu có). */
async function undoOnlineAttendance(req: RequestRow): Promise<void> {
  for (const date of req.dates) {
    const row = await getMemberDate(req.memberId, date);
    if (!row) continue;
    let touched = false;
    if (row.morningInAt === 'online') {
      row.morningInAt = '';
      touched = true;
    }
    if (row.afternoonInAt === 'online') {
      row.afternoonInAt = '';
      touched = true;
    }
    if (!touched) continue;
    if (!row.morningInAt && !row.afternoonInAt) {
      await deleteAttendance(date, req.memberId);
      continue;
    }
    row.dayFraction = dayFractionFromShifts({
      morningIn: row.morningInAt,
      afternoonIn: row.afternoonInAt,
      afternoonOut: row.afternoonOutAt,
    });
    row.mode = 'office';
    row.status = row.dayFraction >= 1 ? 'present' : 'half';
    row.note = '';
    await saveAttendance(row);
  }
}

export type Decision = 'approve' | 'reject';

/**
 * Đổi quyết định một đơn ĐÃ xử lý (đã duyệt ↔ từ chối) — chỉ giám đốc/admin.
 * Huỷ duyệt: gỡ ngày công đã ghi từ đơn. Duyệt lại: ghi công như duyệt bình thường.
 */
export async function redecideRequest(
  kind: RequestKind,
  id: string,
  approverId: string,
  decision: Decision,
): Promise<RequestRow> {
  const req = await findRequest(kind, id);
  if (!req) throw new ApiError(404, 'Không tìm thấy đơn');
  const approver = await findById(approverId);
  if (!approver || (approver.role !== 'director' && approver.role !== 'admin')) {
    throw new ApiError(403, 'Chỉ giám đốc/admin được đổi quyết định đơn đã xử lý');
  }
  if (req.finalStatus === 'pending') {
    throw new ApiError(400, 'Đơn còn chờ duyệt — dùng nút Duyệt/Từ chối ở tab Chờ duyệt');
  }
  const target: RequestStatus = decision === 'approve' ? 'approved' : 'rejected';
  if (req.finalStatus === target) {
    throw new ApiError(400, target === 'approved' ? 'Đơn này đã được duyệt rồi' : 'Đơn này đã bị từ chối rồi');
  }

  const now = nowTz().toISOString();
  if (target === 'rejected') {
    // Huỷ duyệt → gỡ công đã ghi TRƯỚC khi đổi trạng thái.
    if (kind === 'online') await undoOnlineAttendance(req);
    else await undoLeaveAttendance(req);
  }

  const patch: Record<string, unknown> = {
    DirectorStatus: target,
    DirectorBy: approver.id,
    DirectorAt: now,
    FinalStatus: target,
  };
  // Duyệt lại đơn từng bị leader từ chối: giám đốc ghi đè luôn cấp leader.
  if (target === 'approved' && req.leaderStatus !== 'approved') {
    patch['LeaderStatus'] = 'approved';
    patch['LeaderBy'] = approver.id;
    patch['LeaderAt'] = now;
    req.leaderStatus = 'approved';
  }
  await updateRequest(kind, id, patch);
  req.directorStatus = target;
  req.directorBy = approver.id;
  req.directorAt = now;
  req.finalStatus = target;

  if (target === 'approved') {
    if (kind === 'online') await recordOnlineAttendance(req);
    else await recordLeave(req);
    await notify(req.memberId, {
      type: 'request',
      title: 'Đơn được duyệt lại ✅',
      body: `Đơn ${kindVi(kind)} (${req.dates.join(', ')}) đã được duyệt lại.`,
      url: '/requests',
    }, { background: true });
  } else {
    await notify(req.memberId, {
      type: 'request',
      title: 'Đơn bị huỷ duyệt ❌',
      body: `Đơn ${kindVi(kind)} (${req.dates.join(', ')}) đã bị huỷ duyệt — ngày công từ đơn này được gỡ.`,
      url: '/requests',
    }, { background: true });
  }
  return req;
}

export async function decideRequest(
  kind: RequestKind,
  id: string,
  approverId: string,
  decision: Decision,
): Promise<RequestRow> {
  const req = await findRequest(kind, id);
  if (!req) throw new ApiError(404, 'Không tìm thấy đơn');
  const approver = await findById(approverId);
  if (!approver) throw new ApiError(401, 'Không hợp lệ');
  if (req.finalStatus !== 'pending') throw new ApiError(400, 'Đơn đã được xử lý');

  const now = nowTz().toISOString();
  const patch: Record<string, unknown> = {};

  if (approver.role === 'leader') {
    if (req.leaderStatus !== 'pending') throw new ApiError(400, 'Leader đã xử lý đơn này');
    req.leaderStatus = decision === 'approve' ? 'approved' : 'rejected';
    req.leaderBy = approver.id;
    req.leaderAt = now;
    patch['LeaderStatus'] = req.leaderStatus;
    patch['LeaderBy'] = approver.id;
    patch['LeaderAt'] = now;
  } else if (approver.role === 'director' || approver.role === 'admin') {
    if (req.leaderStatus !== 'approved') {
      throw new ApiError(400, 'Cần leader duyệt trước khi giám đốc duyệt');
    }
    if (req.directorStatus !== 'pending') throw new ApiError(400, 'Giám đốc đã xử lý đơn này');
    req.directorStatus = decision === 'approve' ? 'approved' : 'rejected';
    req.directorBy = approver.id;
    req.directorAt = now;
    patch['DirectorStatus'] = req.directorStatus;
    patch['DirectorBy'] = approver.id;
    patch['DirectorAt'] = now;
  } else {
    throw new ApiError(403, 'Không đủ quyền duyệt');
  }

  req.finalStatus = recomputeFinal(req.leaderStatus, req.directorStatus);
  patch['FinalStatus'] = req.finalStatus;
  await updateRequest(kind, id, patch);

  // Side effects + notifications.
  if (req.finalStatus === 'approved') {
    if (kind === 'online') await recordOnlineAttendance(req);
    else await recordLeave(req);
    await notify(req.memberId, {
      type: 'request',
      title: 'Đơn đã được duyệt ✅',
      body: `Đơn ${kindVi(kind)} (${req.dates.join(', ')}) đã được duyệt.`,
      url: '/requests',
    }, { background: true });
  } else if (req.finalStatus === 'rejected') {
    await notify(req.memberId, {
      type: 'request',
      title: 'Đơn bị từ chối ❌',
      body: `Đơn ${kindVi(kind)} (${req.dates.join(', ')}) đã bị từ chối.`,
      url: '/requests',
    }, { background: true });
  } else if (approver.role === 'leader' && decision === 'approve') {
    // Leader approved → notify directors for the next step.
    for (const d of await getDirectors()) {
      await notify(d.id, {
        type: 'request',
        title: 'Đơn chờ giám đốc duyệt',
        body: `${req.name} xin ${kindVi(kind)} (${req.dates.join(', ')}) — leader đã duyệt.`,
        url: '/approvals',
      }, { background: true });
    }
  }
  return req;
}
