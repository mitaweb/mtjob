import { describe, it, expect, vi, beforeEach } from 'vitest';

// Luật thưởng KPI 21/9/2026 ở tầng ghép dữ liệu: ai là leader, gom chỉ số nào, ai bị ×0,5.
// % của từng chỉ số được gài sẵn theo mã — phép quy về tháng đã có kpi.test.ts che.

const PHAN_TRAM: Record<string, number | null> = {};
let DA_CHOT = false;

const duAn = (id: string, status = 'active') => ({ id, name: `Dự án ${id}`, status, startDate: '2026-01-01', endDate: '' });
const kpi = (id: string, projectId: string, teamId: string, active = true) => ({ id, projectId, teamId, name: id, active });
const nguoi = (id: string, role: string, teamId: string) => ({ id, fullName: `Tên ${id}`, role, teamId, active: true });
const pc = (projectId: string, memberId: string, teamId: string, startDate = '2026-01-01', endDate = '') => ({
  projectId,
  memberId,
  teamId,
  startDate,
  endDate,
  assignedBy: '',
});

const DB = {
  projects: [] as ReturnType<typeof duAn>[],
  kpis: [] as ReturnType<typeof kpi>[],
  members: [] as ReturnType<typeof nguoi>[],
  assignees: [] as ReturnType<typeof pc>[],
  teams: [] as Array<{ id: string; name: string; leaderMemberId: string; leaderKpiBonus: number }>,
};

vi.mock('../db/client.js', () => ({ q: vi.fn(async () => []) }));
vi.mock('./projects.repo.js', () => ({
  getProjects: async () => DB.projects,
  getKpis: async () => DB.kpis,
  getEntries: async () => [],
  getAssignees: async () => DB.assignees,
  getBonusLines: async () => [],
}));
vi.mock('./members.repo.js', () => ({ getActiveMembers: async () => DB.members }));
vi.mock('./teams.repo.js', () => ({ getTeams: async () => DB.teams }));
vi.mock('./holidays.repo.js', () => ({ getHolidaySet: async () => new Set<string>() }));
vi.mock('./bonusLock.js', () => ({ isBonusLocked: async () => DA_CHOT }));
vi.mock('../config.js', () => ({ getConfig: async () => ({ kpiPassRate: 80 }) }));
vi.mock('../lib/kpi.js', () => ({
  phanTramTheoThang: (_e: unknown, k: { id: string }) => ({ percent: PHAN_TRAM[k.id] ?? null, soKy: 1, lyDo: '' }),
}));

const { projectBonusForMonth, heSoDiemChiTiet, heSoThuongDiem } = await import('./projectBonus.service.js');

/** Gài n chỉ số cho (dự án × phòng), `dat` cái đầu đạt 100%, còn lại 60%. */
function gai(projectId: string, teamId: string, dat: number, tong: number) {
  for (let i = 0; i < tong; i++) {
    const id = `${projectId}-${teamId}-${i}`;
    DB.kpis.push(kpi(id, projectId, teamId));
    PHAN_TRAM[id] = i < dat ? 100 : 60;
  }
}

beforeEach(() => {
  DA_CHOT = false;
  for (const k of Object.keys(PHAN_TRAM)) delete PHAN_TRAM[k];
  DB.projects = [duAn('P1'), duAn('P2')];
  DB.kpis = [];
  DB.assignees = [];
  DB.members = [nguoi('LA', 'leader', 'Ads'), nguoi('LS', 'leader', 'SEO'), nguoi('M1', 'member', 'Ads')];
  DB.teams = [
    { id: 'Ads', name: 'Ads', leaderMemberId: '', leaderKpiBonus: 3_000_000 },
    { id: 'SEO', name: 'SEO', leaderMemberId: '', leaderKpiBonus: 2_000_000 },
  ];
});

describe('thưởng leader', () => {
  it('gom chỉ số của phòng trên MỌI dự án, mỗi leader đúng MỘT dòng, mức theo team', async () => {
    gai('P1', 'Ads', 5, 5);
    gai('P2', 'Ads', 3, 5); // Ads: 8/10 = 80% → đạt
    gai('P1', 'SEO', 3, 4); // SEO: 3/4 = 75% → trượt
    const r = await projectBonusForMonth(2026, 9);
    expect(r).toHaveLength(2);
    expect(r.find((l) => l.memberId === 'LA')).toMatchObject({ soDat: 8, soChiSo: 10, tyLe: 80, mucThuong: 3_000_000, amount: 3_000_000, projectId: '' });
    expect(r.find((l) => l.memberId === 'LS')).toMatchObject({ soDat: 3, soChiSo: 4, amount: 0, mucThuong: 2_000_000 });
    expect(r.find((l) => l.memberId === 'LS')!.truot).toEqual(['Dự án P1 · P1-SEO-3 (60%)']);
  });

  it('leader căn cứ theo CHỨC VỤ: ô leader của team trỏ vào người khác cũng không ăn thua', async () => {
    gai('P1', 'Ads', 1, 1);
    DB.teams[0].leaderMemberId = 'M1';
    const r = await projectBonusForMonth(2026, 9);
    expect(r.map((l) => l.memberId)).toEqual(['LA']);
  });

  it('hai người cùng chức vụ leader một team → mỗi người một dòng', async () => {
    gai('P1', 'Ads', 1, 1);
    DB.members.push(nguoi('LA2', 'leader', 'Ads'));
    const r = await projectBonusForMonth(2026, 9);
    expect(r.map((l) => l.memberId).sort()).toEqual(['LA', 'LA2']);
  });

  it('dự án tạm dừng và chỉ số đã tắt không tính', async () => {
    gai('P1', 'Ads', 4, 4);
    DB.projects.push(duAn('P3', 'paused'));
    gai('P3', 'Ads', 0, 6);
    DB.kpis.push(kpi('tat', 'P1', 'Ads', false));
    PHAN_TRAM.tat = 0;
    const la = (await projectBonusForMonth(2026, 9)).find((l) => l.memberId === 'LA')!;
    expect(la).toMatchObject({ soDat: 4, soChiSo: 4, amount: 3_000_000 });
  });

  it('không chỉ số nào đo được → 0đ, tyLe null; team chưa đặt mức → 0đ', async () => {
    DB.kpis.push(kpi('x', 'P1', 'Ads'));
    gai('P1', 'SEO', 1, 1);
    DB.teams[1].leaderKpiBonus = 0;
    const r = await projectBonusForMonth(2026, 9);
    expect(r.find((l) => l.memberId === 'LA')).toMatchObject({ tyLe: null, soChiSo: 0, amount: 0 });
    expect(r.find((l) => l.memberId === 'LS')).toMatchObject({ tyLe: 100, amount: 0 });
  });

  it('phòng không có chỉ số ở dự án nào thì không sinh dòng', async () => {
    gai('P1', 'Ads', 1, 1);
    expect((await projectBonusForMonth(2026, 9)).map((l) => l.memberId)).toEqual(['LA']);
  });
});

describe('hệ số thưởng điểm của thành viên', () => {
  it('đếm theo SỐ DỰ ÁN đạt: 1/2 dự án → ×0,5 kèm lý do', async () => {
    gai('P1', 'Ads', 5, 5); // đạt
    gai('P2', 'Ads', 3, 5); // 60% → trượt
    DB.assignees = [pc('P1', 'M1', 'Ads'), pc('P2', 'M1', 'Ads')];
    const h = (await heSoDiemChiTiet(2026, 9)).get('M1')!;
    expect(h).toMatchObject({ heSo: 0.5, lyDo: '1/2 dự án đạt' });
    expect(h.duAn.map((d) => d.dat)).toEqual([true, false]);
    expect((await heSoThuongDiem(2026, 9)).get('M1')).toBe(0.5);
  });

  it('chỉ soi chỉ số của PHÒNG MÌNH trong dự án — SEO trượt không kéo người Ads', async () => {
    gai('P1', 'Ads', 5, 5);
    gai('P1', 'SEO', 0, 5);
    DB.assignees = [pc('P1', 'M1', 'Ads')];
    expect((await heSoDiemChiTiet(2026, 9)).get('M1')).toMatchObject({ heSo: 1, lyDo: '1/1 dự án đạt' });
    expect((await heSoThuongDiem(2026, 9)).has('M1')).toBe(false);
  });

  it('leader KHÔNG bị ×0,5 dù lỡ có tên trong bảng phân công', async () => {
    gai('P1', 'Ads', 0, 5);
    DB.assignees = [pc('P1', 'LA', 'Ads')];
    expect((await heSoDiemChiTiet(2026, 9)).has('LA')).toBe(false);
  });

  it('gỡ khỏi dự án từ tháng trước thì không tính; gỡ giữa tháng vẫn tính; vào tháng sau chưa tính', async () => {
    gai('P1', 'Ads', 0, 5);
    DB.assignees = [pc('P1', 'M1', 'Ads', '2026-01-01', '2026-08-31')];
    expect((await heSoDiemChiTiet(2026, 9)).has('M1')).toBe(false);
    DB.assignees = [pc('P1', 'M1', 'Ads', '2026-01-01', '2026-09-10')];
    expect((await heSoDiemChiTiet(2026, 9)).get('M1')!.heSo).toBe(0.5);
    DB.assignees = [pc('P1', 'M1', 'Ads', '2026-10-01')];
    expect((await heSoDiemChiTiet(2026, 9)).has('M1')).toBe(false);
  });

  it('dự án không đo được bị bỏ qua, không kéo ai xuống', async () => {
    gai('P1', 'Ads', 5, 5);
    DB.kpis.push(kpi('chuaDo', 'P2', 'Ads'));
    DB.assignees = [pc('P1', 'M1', 'Ads'), pc('P2', 'M1', 'Ads')];
    expect((await heSoDiemChiTiet(2026, 9)).get('M1')).toMatchObject({ heSo: 1, lyDo: '1/1 dự án đạt' });
  });
});
