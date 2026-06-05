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
import { saveAttendance } from './attendance.repo.js';
import { notify } from './notifications.service.js';
import { fractionForScope } from '../lib/attendance.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import type { Member, RequestScope, RequestStatus } from '../types.js';

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
    });
  } else {
    for (const d of await getDirectors()) {
      await notify(d.id, {
        type: 'request',
        title: 'Đơn cần duyệt (cấp giám đốc)',
        body: `${member.fullName} xin ${kindVi(i.kind)}: ${i.dates.join(', ')}.`,
        url: '/approvals',
      });
    }
  }
  return row;
}

async function recordOnlineAttendance(req: RequestRow): Promise<void> {
  const member = await findById(req.memberId);
  if (!member) return;
  const fraction = fractionForScope(req.scope || 'full');
  for (const date of req.dates) {
    await saveAttendance({
      date,
      memberId: member.id,
      name: member.fullName,
      morningInAt: req.scope === 'half_pm' ? '' : 'online',
      afternoonInAt: req.scope === 'half_am' ? '' : 'online',
      dayFraction: fraction,
      mode: 'online',
      status: fraction >= 1 ? 'present' : 'half',
      note: `Làm online (đơn ${req.id})`,
    });
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
      note: `Nghỉ phép${req.type ? ` (${req.type})` : ''} — đơn ${req.id}`,
    });
  }
}

export type Decision = 'approve' | 'reject';

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
    });
  } else if (req.finalStatus === 'rejected') {
    await notify(req.memberId, {
      type: 'request',
      title: 'Đơn bị từ chối ❌',
      body: `Đơn ${kindVi(kind)} (${req.dates.join(', ')}) đã bị từ chối.`,
      url: '/requests',
    });
  } else if (approver.role === 'leader' && decision === 'approve') {
    // Leader approved → notify directors for the next step.
    for (const d of await getDirectors()) {
      await notify(d.id, {
        type: 'request',
        title: 'Đơn chờ giám đốc duyệt',
        body: `${req.name} xin ${kindVi(kind)} (${req.dates.join(', ')}) — leader đã duyệt.`,
        url: '/approvals',
      });
    }
  }
  return req;
}
