import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import { useToast } from '../components/Toaster';
import { SkeletonRows } from '../components/ui';
import { useAuth } from '../lib/auth';
import { vnd, currentYm } from '../lib/format';
import { NGUON, CHUA_RO_NGUON } from '../lib/nguon';
import type { Party, FinanceEntry } from '../lib/types';

interface Summary {
  income: number;
  expense: number;
  profit: number;
  receivableTotal: number;
  /** Nợ tồn từ các kỳ trước của mọi bên đang hoạt động. */
  carryOverTotal?: number;
  /** Doanh thu tháng gom theo nguồn khách. */
  theoNguon?: Array<{ nguon: string; tien: number; soKhoan: number; tyLe: number }>;
  entries: FinanceEntry[];
}
interface PayRow {
  memberId: string;
  fullName: string;
  teamId: string;
  salary: number;
  actualDays: number;
  standardDays: number;
  netSalary: number;
}
interface Mem {
  id: string;
  fullName: string;
}

const emptyParty = (): Partial<Party> => ({
  name: '', dueDay: 30, receivable: 0, startDate: '', notifyMemberIds: [], active: true, source: '', kind: 'monthly',
});

/** Khoản một lần trả nhiều đợt (làm phần mềm, web…) — không có kỳ tháng, đòi tới khi đủ tổng. */
const laMotLan = (p: Partial<Party> | null | undefined) => p?.kind === 'once';

export default function Finance() {
  const { user } = useAuth();
  const canEdit = user?.role === 'director' || user?.role === 'admin';
  const init = currentYm();
  const [ym, setYm] = useState(`${init.year}-${String(init.month).padStart(2, '0')}`);
  const [sum, setSum] = useState<Summary | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [members, setMembers] = useState<Mem[]>([]);
  const [pay, setPay] = useState<PayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const [pForm, setPForm] = useState<Partial<Party>>(emptyParty());
  // Form bên hiện trong popup — anh Tâm 16/9/2026: bấm "sửa" ở đâu cũng phải thấy ngay,
  // không phải kéo xuống cuối bảng tìm form.
  const [pFormOpen, setPFormOpen] = useState(false);
  // Đổi mức phải thu: áp từ tháng nào — anh Tâm 16/9/2026: "chỉ 6 triệu từ tháng cập nhật thôi".
  const [applyFrom, setApplyFrom] = useState('');
  const [suaCaQuaKhu, setSuaCaQuaKhu] = useState(false);
  /** Mức lúc mở form — để biết người sửa có đổi mức hay không. */
  const [mucGoc, setMucGoc] = useState(0);
  // Hộp thoại ghi nhận thu công nợ của 1 bên.
  const [collectFor, setCollectFor] = useState<Party | null>(null);
  const [collectInput, setCollectInput] = useState('');
  const [eForm, setEForm] = useState({
    kind: 'thu',
    name: '',
    amount: 0,
    date: '',
    recurring: false,
    source: '',
    customerId: '',
  });
  // Danh sách khách để gắn khoản thu lẻ vào một khách cụ thể.
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; source: string }>>([]);

  function ymQuery() {
    const [y, m] = ym.split('-');
    return `year=${y}&month=${Number(m)}`;
  }

  async function loadAll() {
    const [s, p, mb, py, kh] = await Promise.all([
      api<Summary>(`/finance/summary?month=${ym}`),
      // Truyền tháng: nợ cũ phải tính tới đúng tháng anh đang xem, không phải tháng hiện tại.
      api<{ parties: Party[] }>(`/finance/parties?month=${ym}`),
      api<{ members: Mem[] }>('/finance/members'),
      api<{ rows: PayRow[] }>(`/finance/payroll?${ymQuery()}`),
      api<{ customers: Array<{ id: string; name: string; source: string }> }>('/finance/customers'),
    ]);
    setSum(s);
    setParties(p.parties);
    setMembers(mb.members);
    setPay(py.rows);
    setCustomers(kh.customers);
  }
  useEffect(() => {
    setLoading(true);
    loadAll()
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  async function saveParty() {
    if (!pForm.name) return toast.error('Nhập tên bên.');
    try {
      await api('/finance/parties', {
        body: {
          id: pForm.id,
          name: pForm.name,
          startDate: pForm.startDate || '',
          dueDay: Number(pForm.dueDay) || 30,
          receivable: Number(pForm.receivable) || 0,
          notifyMemberIds: pForm.notifyMemberIds || [],
          active: pForm.active ?? true,
          source: pForm.source || '',
          kind: pForm.kind || 'monthly',
          // '' = sửa cả quá khứ; YYYY-MM = từ tháng đó; bên mới thì không gửi.
          applyFrom: pForm.id ? (suaCaQuaKhu ? '' : applyFrom) : undefined,
        },
      });
      setPForm(emptyParty());
      setPFormOpen(false);
      toast.success('Đã lưu bên');
      await loadAll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function delParty(id: string) {
    await api(`/finance/parties/${id}`, { method: 'DELETE' }).catch(() => {});
    await loadAll();
  }
  /**
   * Các lần khách trả trong tháng đang xem. Mỗi lần trả là MỘT khoản Thu riêng gắn
   * party_id — không còn gộp vào một dòng mã cố định như trước.
   */
  function payments(id: string): FinanceEntry[] {
    return (sum?.entries || []).filter((e) => e.kind === 'thu' && e.partyId === id);
  }
  function collectedAmount(id: string): number {
    return payments(id).reduce((s, e) => s + e.amount, 0);
  }
  function isCollected(id: string): boolean {
    return collectedAmount(id) > 0;
  }

  function openCollect(p: Party) {
    setCollectFor(p);
    // Anh Tâm 25/9/2026: "số tiền mặc định khi đã thu là full số tiền, nếu anh thay đổi thì
    // thay đổi sau". Điền sẵn TOÀN BỘ còn phải đòi (nợ cũ + kỳ này); chưa ghi gì trong tháng
    // mà còn phải đòi = 0 (khách đã trả trước) thì vẫn điền mức của tháng — anh muốn bấm là
    // xong, không phải gõ. Chỉ để TRỐNG khi tháng này đã ghi rồi mà không còn nợ, kẻo bấm
    // nhầm một cái là ghi trùng.
    const conDoi = p.totalDue || 0;
    const mucThang = p.receivableThisMonth ?? p.receivable;
    const goiY = conDoi > 0 ? conDoi : collectedAmount(p.id) === 0 && !laMotLan(p) ? mucThang : 0;
    setCollectInput(goiY > 0 ? String(goiY) : '');
  }

  /** Ghi nhận MỘT lần khách trả. Gọi nhiều lần = nhiều dòng, không đè lên nhau. */
  async function saveCollect(amount: number) {
    if (!collectFor) return;
    const p = collectFor;
    if (amount <= 0) return toast.error('Nhập số tiền lớn hơn 0.');
    try {
      await api(`/finance/parties/${p.id}/collect`, { body: { month: ym, amount } });
      // Tiền vào trừ nợ cũ trước (máy chủ tính FIFO) — nói rõ để anh khỏi quay về tháng cũ bấm lại.
      const truNoCu = Math.min(amount, p.carryOver || 0);
      const conNo = Math.max(0, (p.totalDue || 0) - amount);
      toast.success(
        `Đã ghi nhận ${vnd(amount)}` +
          (truNoCu > 0 ? ` — trừ nợ cũ ${vnd(truNoCu)}` : '') +
          (conNo > 0 ? `, còn nợ ${vnd(conNo)}` : ' — sạch nợ'),
      );
      await loadAll();
      setCollectInput('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Xoá một lần trả ghi nhầm. */
  async function xoaLanTra(id: string) {
    if (!window.confirm('Xoá lần thu này?')) return;
    try {
      await api(`/finance/entries/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function saveEntry() {
    if (!eForm.name) return toast.error('Nhập tên khoản.');
    try {
      await api('/finance/entries', { body: { month: ym, ...eForm, amount: Number(eForm.amount) || 0 } });
      setEForm({ kind: 'thu', name: '', amount: 0, date: '', recurring: false, source: '', customerId: '' });
      toast.success('Đã lưu khoản');
      await loadAll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function delEntry(id: string) {
    await api(`/finance/entries/${id}`, { method: 'DELETE' }).catch(() => {});
    await loadAll();
  }
  function toggleNotify(id: string) {
    const cur = pForm.notifyMemberIds || [];
    setPForm({ ...pForm, notifyMemberIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Tài chính</h1>
          <p className="text-sm text-ink-muted">Công nợ các bên · thu/chi theo tháng · lãi lỗ{canEdit ? '' : ' (chế độ xem)'}</p>
        </div>
        <input type="month" className="input max-w-[10rem]" value={ym} onChange={(e) => setYm(e.target.value)} />
      </div>

      {/* Tổng hợp */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Thu" value={vnd(sum?.income ?? 0)} cls="text-emerald-700" />
        <Stat label="Chi" value={vnd(sum?.expense ?? 0)} cls="text-rose-600" />
        <Stat label="Lãi / Lỗ" value={vnd(sum?.profit ?? 0)} cls={(sum?.profit ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-600'} />
        <Stat
          label={sum?.carryOverTotal ? 'Phải thu tháng này + nợ cũ' : 'Tổng phải thu/tháng'}
          value={vnd((sum?.receivableTotal ?? 0) + (sum?.carryOverTotal ?? 0))}
          cls="text-brand-600"
        />
      </div>
      {/* Nợ tồn nói riêng — con số này mới là tiền đang bị giữ ngoài công ty. */}
      {!!sum?.carryOverTotal && (
        <p className="-mt-1 text-xs text-ink-muted">
          Trong đó <b className="text-rose-600">{vnd(sum.carryOverTotal)}</b> là nợ các tháng trước chưa thu.
        </p>
      )}

      {/* Các bên */}
      <div className="card">
        <h2 className="font-semibold mb-2">Các bên & công nợ phải thu</h2>
        {loading && parties.length === 0 ? <SkeletonRows rows={3} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1">Tên bên</th>
                <th className="text-right">Phải thu</th>
                <th className="text-right">Nợ cũ</th>
                <th className="text-right">Tổng phải đòi</th>
                <th className="text-center">Ngày thu</th>
                <th>Hạn kế tiếp</th>
                <th>Nhắc cho</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1">
                    {/* Nguồn khách ở góc phải phía trên tên — anh Tâm 16/9/2026. */}
                    <div className="flex flex-col">
                      {p.source && (
                        <span className="self-end rounded-md bg-brand-50 px-1.5 text-[10px] leading-4 text-ink-muted">
                          {p.source}
                        </span>
                      )}
                      <span>{p.name}</span>
                    </div>
                  </td>
                  {/* Mức của RIÊNG tháng đang xem — đổi mức từ tháng 9 thì xem tháng 8 vẫn thấy mức cũ. */}
                  <td className="text-right">
                    {vnd(p.receivableThisMonth ?? p.receivable)}
                    {laMotLan(p) && (
                      <div className="text-[10px] leading-4 text-ink-muted">
                        một lần · đã trả {vnd(p.paidTotal || 0)}
                      </div>
                    )}
                  </td>
                  {/* Nợ cũ = tiền các kỳ TRƯỚC còn thiếu. Rê chuột để xem thiếu tháng nào. */}
                  <td className="text-right" title={(p.unpaidMonths || []).join(', ')}>
                    {laMotLan(p) ? (
                      <span className="text-ink-faint">—</span>
                    ) : p.carryOver ? (
                      <span className="font-medium text-rose-600">{vnd(p.carryOver)}</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="text-right font-medium">
                    {p.totalDue ? vnd(p.totalDue) : <span className="text-emerald-700">đã thu đủ</span>}
                  </td>
                  <td className="text-center">{p.dueDay}</td>
                  <td>{laMotLan(p) && !p.totalDue ? <span className="text-ink-faint">—</span> : p.nextDue}</td>
                  <td className="text-xs">
                    {(p.notifyMemberIds || []).map((id) => members.find((m) => m.id === id)?.fullName).filter(Boolean).join(', ') || '— (giám đốc)'}
                  </td>
                  {canEdit && (
                    <td className="text-right whitespace-nowrap">
                      <button
                        className={`mr-2 rounded-lg border px-2 py-0.5 text-xs font-medium ${
                          // Xanh khi KHÔNG CÒN NỢ (máy chủ tính, đã trừ nợ cũ) — không phải khi
                          // "thu tháng này ≥ mức": thu 21tr ở tháng 9 mà tháng 8 còn treo thì chưa xong.
                          isCollected(p.id) && !p.totalDue
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : isCollected(p.id)
                              ? 'border-amber-500 bg-amber-50 text-amber-700'
                              : 'border-brand-200 text-ink-soft hover:bg-brand-50'
                        }`}
                        onClick={() => openCollect(p)}
                        title={p.paidToOld ? `Trong đó ${vnd(p.paidToOld)} đã trừ nợ tháng trước` : undefined}
                      >
                        {laMotLan(p)
                          ? !p.totalDue
                            ? '✓ Đã thu đủ'
                            : p.paidTotal
                              ? `Đã trả ${vnd(p.paidTotal)}`
                              : 'Ghi đợt trả'
                          : !isCollected(p.id)
                            ? 'Đã thu'
                            : !p.totalDue
                              ? '✓ Đã thu đủ'
                              : `Thu ${vnd(collectedAmount(p.id))}`}
                      </button>
                      <button
                        className="text-brand-600 underline text-xs mr-2"
                        onClick={() => {
                          setPForm({ ...p });
                          setMucGoc(p.receivable);
                          setApplyFrom(ym);
                          setSuaCaQuaKhu(false);
                          setPFormOpen(true);
                        }}
                      >
                        sửa
                      </button>
                      <button className="text-rose-600 underline text-xs" onClick={() => delParty(p.id)}>
                        xóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {parties.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-2 text-ink-muted">
                    Chưa có bên nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="mt-3">
            <button
              className="btn-ghost"
              onClick={() => {
                setPForm(emptyParty());
                setMucGoc(0);
                setPFormOpen(true);
              }}
            >
              ➕ Thêm bên
            </button>
          </div>
        )}
      </div>

      {/* Popup thêm / sửa bên — mở từ nút "sửa" ở bất kỳ dòng nào hoặc nút "Thêm bên". */}
      {canEdit && pFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
          onClick={() => setPFormOpen(false)}
        >
          <div className="card hien-len my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{pForm.id ? `Sửa bên — ${pForm.name || ''}` : '➕ Thêm bên'}</h2>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setPFormOpen(false)}>
                ✕ Đóng
              </button>
            </div>
            {/* Loại khoản — anh Tâm 25/9/2026: "khoản thu 1 lần, ví dụ làm phần mềm, khách chuyển
                khoản từng lần chứ không chuyển hết, cần ghi nhận công nợ để đòi đủ". */}
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  ['monthly', 'Thu hàng tháng'],
                  ['once', 'Một lần, trả nhiều đợt'],
                ] as const
              ).map(([k, nhan]) => (
                <label
                  key={k}
                  className={`cursor-pointer rounded-lg border px-3 py-1 ${
                    (pForm.kind || 'monthly') === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-white'
                  }`}
                >
                  <input type="radio" className="hidden" checked={(pForm.kind || 'monthly') === k} onChange={() => setPForm({ ...pForm, kind: k })} />
                  {nhan}
                </label>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input className="input py-1" placeholder="Tên bên / khách hàng" value={pForm.name || ''} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
              <input
                className="input py-1"
                type="number"
                placeholder={laMotLan(pForm) ? 'Tổng giá trị hợp đồng' : 'Số tiền phải thu mỗi tháng'}
                value={pForm.receivable || ''}
                onChange={(e) => setPForm({ ...pForm, receivable: Number(e.target.value) })}
              />
              {laMotLan(pForm) && (
                <p className="sm:col-span-2 text-xs text-ink-muted">
                  Khách trả từng đợt, mỗi đợt bấm "Ghi đợt trả". Còn nợ = tổng hợp đồng − các đợt đã trả, đòi tới khi đủ.
                  Sửa tổng thì còn nợ tính lại ngay.
                </p>
              )}
              {/* Đổi mức bên đang có: hỏi áp từ tháng nào, mặc định tháng đang xem. Tháng trước giữ mức cũ. */}
              {pForm.id && !laMotLan(pForm) && Number(pForm.receivable || 0) !== mucGoc && (
                <div className="sm:col-span-2 rounded-lg border border-accent-300 bg-accent-50 p-2 text-xs text-ink">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      Mức mới <b>{vnd(Number(pForm.receivable) || 0)}</b> áp dụng từ tháng
                    </span>
                    <input
                      type="month"
                      className="input max-w-[10rem] py-0.5"
                      value={applyFrom}
                      disabled={suaCaQuaKhu}
                      onChange={(e) => setApplyFrom(e.target.value)}
                    />
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={suaCaQuaKhu} onChange={(e) => setSuaCaQuaKhu(e.target.checked)} />
                      sửa cả các tháng trước
                    </label>
                  </div>
                  <p className="mt-1 text-ink-muted">
                    {suaCaQuaKhu
                      ? `Mọi tháng đều tính ${vnd(Number(pForm.receivable) || 0)} — nợ cũ sẽ tính lại theo mức này.`
                      : `Các tháng trước ${applyFrom || '…'} vẫn tính ${vnd(mucGoc)}. Nợ cũ không đổi.`}
                  </p>
                </div>
              )}
              {pForm.id && !laMotLan(pForm) && (pForm.rates || []).length > 0 && (
                <p className="sm:col-span-2 text-xs text-ink-muted">
                  Lịch sử mức:{' '}
                  {(pForm.rates || [])
                    .map((r) => `${r.fromMonth === '0000-00' ? 'từ đầu' : `từ ${r.fromMonth}`}: ${vnd(r.receivable)}`)
                    .join(' · ')}
                </p>
              )}
              <label className="text-xs text-ink-muted">
                {laMotLan(pForm) ? 'Ngày nhắc đòi hàng tháng (khi còn nợ)' : 'Ngày thu hàng tháng'}
                <input className="input py-1" type="number" min={1} max={31} value={pForm.dueDay || 30} onChange={(e) => setPForm({ ...pForm, dueDay: Number(e.target.value) })} />
              </label>
              <label className="text-xs text-ink-muted">
                {laMotLan(pForm) ? 'Ngày ký / bắt đầu' : 'Ngày bắt đầu'}
                <input className="input py-1" type="date" value={pForm.startDate || ''} onChange={(e) => setPForm({ ...pForm, startDate: e.target.value })} />
              </label>
              {/* Chọn MỘT LẦN ở đây, mọi khoản thu của bên này tự mang nguồn đó. */}
              <label className="text-xs text-ink-muted">
                Nguồn khách
                <select
                  className="input py-1"
                  value={pForm.source || ''}
                  onChange={(e) => setPForm({ ...pForm, source: e.target.value })}
                >
                  <option value="">— chưa rõ —</option>
                  {NGUON.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <div className="text-xs text-ink-muted mb-1">Người nhận nhắc thu (5 ngày trước hạn):</div>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <label key={m.id} className={`text-xs px-2 py-1 rounded-lg cursor-pointer border ${(pForm.notifyMemberIds || []).includes(m.id) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-brand-200'}`}>
                    <input type="checkbox" className="hidden" checked={(pForm.notifyMemberIds || []).includes(m.id)} onChange={() => toggleNotify(m.id)} />
                    {m.fullName}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <AsyncButton className="btn-primary" onClick={saveParty} busyLabel="Đang lưu…">
                {pForm.id ? 'Lưu' : 'Thêm bên'}
              </AsyncButton>
              <button
                className="btn-ghost"
                onClick={() => {
                  setPForm(emptyParty());
                  setPFormOpen(false);
                }}
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thu / Chi */}
      <div className="card">
        <h2 className="font-semibold mb-2">Thu / Chi tháng {ym}</h2>
        {loading && (sum?.entries || []).length === 0 ? <SkeletonRows rows={3} /> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1">Khoản</th>
                <th>Loại</th>
                <th className="text-right">Số tiền</th>
                <th>Ngày</th>
                <th>Hàng tháng</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {(sum?.entries || []).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-1">{e.name}</td>
                  <td className={e.kind === 'thu' ? 'text-emerald-700' : 'text-rose-600'}>{e.kind === 'thu' ? 'Thu' : 'Chi'}</td>
                  <td className="text-right">{vnd(e.amount)}</td>
                  <td>{e.date || '—'}</td>
                  <td>{e.recurring ? '🔁' : ''}</td>
                  {canEdit && (
                    <td className="text-right">
                      <button className="text-rose-600 underline text-xs" onClick={() => delEntry(e.id)}>
                        xóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {(sum?.entries || []).length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-2 text-ink-muted">
                    Chưa có khoản thu/chi nào trong tháng.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="bg-brand-50 rounded-xl p-3 mt-3 grid sm:grid-cols-6 gap-2 items-end">
            <select className="input py-1" value={eForm.kind} onChange={(e) => setEForm({ ...eForm, kind: e.target.value })}>
              <option value="thu">Thu</option>
              <option value="chi">Chi</option>
            </select>
            <input className="input py-1 sm:col-span-2" placeholder="Tên khoản" value={eForm.name} onChange={(e) => setEForm({ ...eForm, name: e.target.value })} />
            <input className="input py-1" type="number" placeholder="Số tiền" value={eForm.amount || ''} onChange={(e) => setEForm({ ...eForm, amount: Number(e.target.value) })} />
            <input className="input py-1" type="date" value={eForm.date} onChange={(e) => setEForm({ ...eForm, date: e.target.value })} />
            <label className="text-xs text-ink-soft flex items-center gap-1">
              <input type="checkbox" checked={eForm.recurring} onChange={(e) => setEForm({ ...eForm, recurring: e.target.checked })} />
              Hàng tháng
            </label>
            {/* Chỉ khoản THU mới có nguồn khách — khoản chi hỏi nguồn là vô nghĩa. */}
            {eForm.kind === 'thu' && (
              <>
                <label className="text-xs text-ink-muted sm:col-span-3">
                  Nguồn khách
                  <select
                    className="input py-1"
                    value={eForm.source}
                    onChange={(e) => setEForm({ ...eForm, source: e.target.value })}
                  >
                    <option value="">— chưa rõ —</option>
                    {NGUON.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-muted sm:col-span-3">
                  Khách hàng (bỏ trống cũng được)
                  <select
                    className="input py-1"
                    value={eForm.customerId}
                    onChange={(e) => setEForm({ ...eForm, customerId: e.target.value })}
                  >
                    <option value="">— không gắn khách —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.source ? ` · ${c.source}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <AsyncButton className="btn-primary sm:col-span-6" onClick={saveEntry} busyLabel="Đang lưu…">
              ➕ Thêm khoản
            </AsyncButton>
          </div>
        )}
      </div>

      {/* Doanh thu theo nguồn khách — anh Tâm 21/8/2026. */}
      <div className="card">
        <h2 className="font-semibold mb-2">Doanh thu theo nguồn khách (tháng {ym})</h2>
        {!sum?.theoNguon?.length ? (
          <p className="text-sm text-ink-muted">Tháng này chưa có khoản thu nào.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-ink-muted">
                  <tr>
                    <th className="py-1">Nguồn</th>
                    <th className="text-right">Doanh thu</th>
                    <th className="text-right">Số khoản</th>
                    <th className="text-right">Tỉ trọng</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.theoNguon.map((n) => (
                    <tr key={n.nguon} className="border-t">
                      <td className="py-1 font-medium">
                        {n.nguon === CHUA_RO_NGUON ? (
                          <span className="text-amber-700">⚠️ {n.nguon}</span>
                        ) : (
                          n.nguon
                        )}
                      </td>
                      <td className="text-right font-medium">{vnd(n.tien)}</td>
                      <td className="text-right text-ink-muted">{n.soKhoan}</td>
                      <td className="text-right">
                        <span className="inline-flex items-center gap-1.5">
                          {/* Thanh tỉ trọng: nhìn một cái là biết nguồn nào gánh doanh thu. */}
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-brand-100 sm:inline-block">
                            <span
                              className="block h-full rounded-full bg-brand-600"
                              style={{ width: `${n.tyLe}%` }}
                            />
                          </span>
                          {n.tyLe}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sum.theoNguon.some((n) => n.nguon === CHUA_RO_NGUON) && (
              <p className="mt-2 text-xs text-amber-700">
                Khoản chưa gắn nguồn vẫn được đếm vào tổng. Gắn nguồn cho bên công nợ ở mục trên, hoặc
                chọn nguồn khi thêm khoản thu.
              </p>
            )}
          </>
        )}
      </div>

      {/* Lương nhân sự (xem) */}
      <div className="card">
        <h2 className="font-semibold mb-2">Lương nhân sự (tháng {ym})</h2>
        {loading && pay.length === 0 ? <SkeletonRows rows={4} /> : null}
        {/* Mobile: dạng thẻ cho dễ đọc */}
        <ul className="md:hidden divide-y">
          {pay.map((r) => (
            <li key={r.memberId} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.fullName}</span>
                <span className="font-medium text-emerald-700">{vnd(r.netSalary)}</span>
              </div>
              <div className="text-xs text-ink-muted">
                {r.teamId || '—'} · Công {r.actualDays}/{r.standardDays} · Mức lương {vnd(r.salary)}
              </div>
            </li>
          ))}
        </ul>
        <table className="w-full text-sm hidden md:table">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-1">Họ tên</th>
              <th>Team</th>
              <th className="text-right">Mức lương</th>
              <th className="text-center">Công</th>
              <th className="text-right">Thực lãnh</th>
            </tr>
          </thead>
          <tbody>
            {pay.map((r) => (
              <tr key={r.memberId} className="border-t">
                <td className="py-1">{r.fullName}</td>
                <td>{r.teamId}</td>
                <td className="text-right">{vnd(r.salary)}</td>
                <td className="text-center">
                  {r.actualDays}/{r.standardDays}
                </td>
                <td className="text-right font-medium text-emerald-700">{vnd(r.netSalary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hộp thoại ghi nhận thu công nợ */}
      {collectFor && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
          onClick={() => setCollectFor(null)}
        >
          <div className="card hien-len my-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">
                {laMotLan(collectFor) ? 'Ghi đợt trả' : 'Thu công nợ'} — {collectFor.name}
              </h2>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setCollectFor(null)}>
                ✕ Đóng
              </button>
            </div>

            {laMotLan(collectFor) ? (
              <div className="rounded-xl bg-brand-50 p-3 text-sm">
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Tổng hợp đồng</span>
                  <span className="font-medium">{vnd(collectFor.receivable)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Đã trả (tất cả các đợt)</span>
                  <span className="font-medium text-emerald-700">{vnd(collectFor.paidTotal || 0)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-brand-100 pt-1.5">
                  <span className="text-ink-muted">Còn nợ</span>
                  <span className="font-medium text-rose-600">{vnd(collectFor.totalDue || 0)}</span>
                </div>
                {!!collectFor.credit && (
                  <div className="mt-1 flex justify-between border-t border-brand-100 pt-1.5">
                    <span className="text-ink-muted">Khách trả dư</span>
                    <span className="font-medium text-emerald-700">{vnd(collectFor.credit)}</span>
                  </div>
                )}
              </div>
            ) : (
            <div className="rounded-xl bg-brand-50 p-3 text-sm">
              {/* Tiền vào trừ nợ cũ trước — bày rõ để người nhập không quay về tháng cũ bấm lại. */}
              {!!collectFor.carryOver && (
                <div className="flex justify-between py-0.5" title={(collectFor.unpaidMonths || []).join(', ')}>
                  <span className="text-ink-muted">Nợ các tháng trước còn lại</span>
                  <span className="font-medium text-rose-600">{vnd(collectFor.carryOver)}</span>
                </div>
              )}
              <div className="flex justify-between py-0.5">
                <span className="text-ink-muted">Phải thu tháng {ym}</span>
                <span className="font-medium">{vnd(collectFor.receivableThisMonth ?? collectFor.receivable)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-ink-muted">
                  Đã ghi nhận tháng này
                  {!!collectFor.paidToOld && (
                    <span className="text-xs"> (trong đó {vnd(collectFor.paidToOld)} trừ nợ cũ)</span>
                  )}
                </span>
                <span className="font-medium text-emerald-700">{vnd(collectedAmount(collectFor.id))}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-brand-100 pt-1.5">
                <span className="text-ink-muted">Còn phải thu (cả nợ cũ)</span>
                <span className="font-medium text-rose-600">{vnd(collectFor.totalDue || 0)}</span>
              </div>
              {/* Kỳ này 0đ mà chưa ghi gì trong tháng = tiền khách trả trước đã bù — nói rõ, kẻo tưởng lỗi. */}
              {!collectFor.totalDue && collectedAmount(collectFor.id) === 0 && (collectFor.receivableThisMonth ?? 0) > 0 && (
                <p className="mt-1 text-xs text-ink-muted">
                  Kỳ này đã được bù bằng tiền khách trả dư ở các tháng trước. Ghi thêm là tiền để dành cho kỳ sau.
                </p>
              )}
              {!!collectFor.credit && (
                <div className="mt-1 flex justify-between border-t border-brand-100 pt-1.5">
                  <span className="text-ink-muted">Khách trả trước, để dành kỳ sau</span>
                  <span className="font-medium text-emerald-700">{vnd(collectFor.credit)}</span>
                </div>
              )}
            </div>
            )}

            {/* Từng lần trả — công nợ cần biết trả mấy lần, ngày nào, chứ không chỉ tổng. */}
            {payments(collectFor.id).length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-ink-muted">
                  Đã thu {payments(collectFor.id).length} lần trong tháng {ym}
                </div>
                <ul className="divide-y rounded-xl border">
                  {payments(collectFor.id).map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{vnd(e.amount)}</span>
                        {e.date ? <span className="text-ink-muted"> · {e.date}</span> : null}
                      </span>
                      <button className="shrink-0 text-xs text-rose-600 underline" onClick={() => xoaLanTra(e.id)}>
                        xoá
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3">
              <label className="label" htmlFor="collect-amount">
                Số tiền thu lần này
              </label>
              <input
                id="collect-amount"
                className="input"
                type="number"
                min={0}
                value={collectInput}
                onChange={(e) => setCollectInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCollect(Number(collectInput) || 0)}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Nhập số của <b>riêng lần này</b>, không phải tổng. Khách trả 2–3 lần thì ghi nhận 2–3 lần,
                mỗi lần một dòng.{' '}
                {laMotLan(collectFor) ? 'Đợt trả ghi vào tháng đang xem.' : 'Trả dư sẽ tự để dành trừ cho các kỳ sau.'}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <AsyncButton
                className="btn-primary"
                onClick={() => saveCollect(Number(collectInput) || 0)}
                busyLabel="Đang lưu…"
              >
                ＋ Ghi nhận lần thu này
              </AsyncButton>
              {/* "Còn lại" = cả nợ cũ lẫn kỳ này (máy chủ tính FIFO, đúng mức từng tháng). */}
              {(collectFor.totalDue || 0) > 0 && (
                <AsyncButton
                  className="btn-ghost"
                  onClick={() => saveCollect(collectFor.totalDue || 0)}
                  busyLabel="Đang lưu…"
                >
                  ✓ Thu nốt phần còn lại ({vnd(collectFor.totalDue || 0)})
                </AsyncButton>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="card text-center">
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}
