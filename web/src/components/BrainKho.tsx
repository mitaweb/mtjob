// Các tab "bộ não thứ hai" của trang Kho tri thức (anh Tâm 4/10/2026): mỗi thứ trong kho là một
// MỤC đọc được, có nhãn (nhóm · khách · phòng · ai xem được), và lúc hỏi trợ lý tra đúng theo nhãn.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge, EmptyState, PhanTrang, SkeletonRows, type BadgeVariant } from './ui';

export interface BrainItem {
  id: string;
  title: string;
  body: string;
  summary: string;
  category: string;
  customerId: string;
  customer: string;
  teamId: string;
  tags: string[];
  scope: string;
  status: 'published' | 'pending' | 'rejected' | 'archived';
  source: string;
  submittedBy: string;
  submittedName: string;
  approvedBy: string;
  aiReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface Nhom {
  key: string;
  label: string;
  count: number;
}

interface Question {
  id: string;
  question: string;
  askedName: string;
  teamId: string;
  times: number;
  createdAt: string;
}

const fmtD = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

const PHAM_VI: Array<[string, string]> = [
  ['all', 'Cả công ty'],
  ['team:Ads', 'Phòng Ads'],
  ['team:Content', 'Phòng Content'],
  ['team:SEO', 'Phòng SEO'],
  ['director', 'Chỉ giám đốc'],
];
const tenPhamVi = (s: string) => PHAM_VI.find(([k]) => k === s)?.[1] || s;

const TRANG_THAI: Record<BrainItem['status'], { label: string; variant: BadgeVariant }> = {
  published: { label: 'Đã vào kho', variant: 'success' },
  pending: { label: 'Chờ duyệt', variant: 'warn' },
  rejected: { label: 'Không lưu', variant: 'danger' },
  archived: { label: 'Đã lưu trữ', variant: 'neutral' },
};

// ── Quy tắc: cái gì vào, cái gì không ──

export function QuyTacKho() {
  const [mo, setMo] = useState(false);
  return (
    <div className="card">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setMo(!mo)}>
        <span className="font-semibold">📏 Cái gì vào kho, cái gì không</span>
        <span className="shrink-0 text-xs text-brand-600 underline">{mo ? 'Thu gọn' : 'Xem'}</span>
      </button>
      {mo && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <div className="mb-1 font-medium text-emerald-800">✅ Đưa vào kho</div>
            <ul className="list-disc space-y-0.5 pl-4 text-ink-soft">
              <li>Khách hàng: sở thích, điều cần tránh, lịch sử làm việc</li>
              <li>Quy trình làm việc</li>
              <li>Tiêu chuẩn thiết kế & nội dung: màu, font, giọng văn</li>
              <li>Dịch vụ & bảng giá</li>
              <li>Chính sách nhân sự (luật, không phải số của ai)</li>
              <li>Cách xử lý tình huống với khách</li>
              <li>Mẫu tin nhắn, báo giá, brief</li>
              <li>Hướng dẫn công cụ (không kèm mật khẩu)</li>
              <li>Quyết định đã chốt</li>
            </ul>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <div className="mb-1 font-medium text-amber-800">🔒 Chỉ giám đốc xem</div>
            <ul className="list-disc space-y-0.5 pl-4 text-ink-soft">
              <li>Lịch trình, lịch hẹn cá nhân</li>
              <li>Phân tích, đánh giá từng nhân viên</li>
              <li>Lương, thưởng, kỷ luật của một người</li>
              <li>Tài chính, doanh thu, công nợ công ty</li>
            </ul>
          </div>
          <div className="rounded-xl bg-rose-50 p-3">
            <div className="mb-1 font-medium text-rose-800">⛔ Không lưu</div>
            <ul className="list-disc space-y-0.5 pl-4 text-ink-soft">
              <li>Số liệu thay đổi hằng ngày (điểm, chấm công, công nợ) — trợ lý tra bảng thật</li>
              <li>Mật khẩu, API key, OTP, số tài khoản — chặn hẳn</li>
              <li>SĐT, email khách — tự ẩn</li>
              <li>Chuyện phiếm, câu chung chung, ý kiến chưa chốt</li>
            </ul>
          </div>
          <p className="text-xs text-ink-muted sm:col-span-3">
            Ai cũng đóng góp được. AI đọc từng nội dung, xếp nhóm, gắn đúng khách và quyết định ai xem được; điều gì chưa
            chắc thì chờ giám đốc duyệt. Nhân viên hỏi điều kho chưa có thì câu hỏi được chuyển cho giám đốc.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Một mục trong danh sách + popup đọc/sửa ──

function DongMuc({ i, nhom, onOpen, hienTrangThai }: { i: BrainItem; nhom: Map<string, string>; onOpen: () => void; hienTrangThai?: boolean }) {
  return (
    <li className="py-2">
      <button className="w-full text-left" onClick={onOpen}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="info">{nhom.get(i.category) || i.category}</Badge>
          {i.customer && <Badge variant="success">{i.customer}</Badge>}
          {i.scope !== 'all' && <Badge variant="neutral">{tenPhamVi(i.scope)}</Badge>}
          {hienTrangThai && <Badge variant={TRANG_THAI[i.status].variant}>{TRANG_THAI[i.status].label}</Badge>}
        </div>
        <div className="mt-1 font-medium text-ink">{i.title}</div>
        {i.summary && <div className="text-sm text-ink-muted">{i.summary}</div>}
        <div className="text-xs text-ink-faint">
          {i.submittedName ? `${i.submittedName} · ` : ''}cập nhật {fmtD(i.updatedAt)}
        </div>
      </button>
    </li>
  );
}

export function PopupMuc({
  item,
  nhomList,
  isDirector,
  onClose,
  onSaved,
}: {
  item: BrainItem;
  nhomList: Nhom[];
  isDirector: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [sua, setSua] = useState(false);
  const [f, setF] = useState({ title: item.title, body: item.body, category: item.category, scope: item.scope, customer: item.customer });
  const nhom = new Map(nhomList.map((n) => [n.key, n.label]));

  async function luu(extra: Record<string, unknown> = {}) {
    try {
      await api(`/brain/items/${item.id}`, { method: 'PATCH', body: { ...(sua ? f : {}), ...extra } });
      toast.success('Đã lưu');
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={onClose}>
      <div className="card hien-len my-8 w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="info">{nhom.get(item.category) || item.category}</Badge>
              {item.customer && <Badge variant="success">{item.customer}</Badge>}
              <Badge variant="neutral">{tenPhamVi(item.scope)}</Badge>
              <Badge variant={TRANG_THAI[item.status].variant}>{TRANG_THAI[item.status].label}</Badge>
            </div>
            {!sua && <h2 className="mt-2 text-lg font-semibold">{item.title}</h2>}
          </div>
          <button className="btn-ghost shrink-0 px-2 py-1 text-sm" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>

        {sua ? (
          <div className="space-y-2">
            <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Tiêu đề" />
            <textarea className="input min-h-[12rem]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-label="Nội dung" />
            {isDirector && (
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-ink-muted">
                  Nhóm
                  <select className="input py-1" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                    {nhomList.map((n) => (
                      <option key={n.key} value={n.key}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-muted">
                  Ai xem được
                  <select className="input py-1" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
                    {PHAM_VI.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-muted">
                  Khách hàng
                  <input className="input py-1" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} placeholder="để trống nếu không" />
                </label>
              </div>
            )}
          </div>
        ) : (
          <>
            {item.summary && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink-soft">{item.summary}</p>}
            <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm text-ink">{item.body}</p>
            {item.tags.length > 0 && <p className="text-xs text-ink-muted">Từ khoá: {item.tags.join(', ')}</p>}
            <p className="text-xs text-ink-faint">
              {item.submittedName ? `Gửi bởi ${item.submittedName} · ` : ''}tạo {fmtD(item.createdAt)} · cập nhật {fmtD(item.updatedAt)}
              {item.approvedBy ? ` · ban hành: ${item.approvedBy}` : ''}
            </p>
            {item.aiReason && isDirector && <p className="text-xs text-ink-muted">🤖 AI: {item.aiReason}</p>}
          </>
        )}

        {isDirector && (
          <div className="flex flex-wrap gap-2 border-t border-brand-100 pt-3">
            {sua ? (
              <>
                <AsyncButton className="btn-primary" onClick={() => luu()} busyLabel="Đang lưu…">
                  Lưu
                </AsyncButton>
                <button className="btn-ghost" onClick={() => setSua(false)}>
                  Huỷ sửa
                </button>
              </>
            ) : (
              <>
                {item.status !== 'published' && (
                  <AsyncButton className="btn-primary" onClick={() => luu({ status: 'published' })} busyLabel="…">
                    ✓ Ban hành
                  </AsyncButton>
                )}
                <button className="btn-ghost" onClick={() => setSua(true)}>
                  ✏️ Sửa / đổi nhãn
                </button>
                {item.status === 'pending' && (
                  <AsyncButton className="btn-ghost text-rose-600" onClick={() => luu({ status: 'rejected' })} busyLabel="…">
                    Không lưu
                  </AsyncButton>
                )}
                {item.status === 'published' && (
                  <AsyncButton
                    className="btn-ghost text-rose-600"
                    onClick={() => (window.confirm('Lưu trữ mục này? Trợ lý sẽ không dùng nó để trả lời nữa.') ? luu({ status: 'archived' }) : Promise.resolve())}
                    busyLabel="…"
                  >
                    Lưu trữ
                  </AsyncButton>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab Kho: duyệt theo nhóm ──

export function TabKho({ nhomList, isDirector, reloadKey, onChanged }: { nhomList: Nhom[]; isDirector: boolean; reloadKey: number; onChanged: () => void }) {
  const toast = useToast();
  const [nhom, setNhom] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<BrainItem[] | null>(null);
  const [mo, setMo] = useState<BrainItem | null>(null);
  const tenNhom = useMemo(() => new Map(nhomList.map((n) => [n.key, n.label])), [nhomList]);

  async function tai() {
    const p = new URLSearchParams();
    if (nhom) p.set('category', nhom);
    if (q.trim()) p.set('q', q.trim());
    const r = await api<{ items: BrainItem[] }>(`/brain/items?${p}`);
    setItems(r.items.filter((i) => isDirector || i.category !== 'rieng'));
  }
  useEffect(() => {
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nhom, reloadKey]);

  const tong = nhomList.filter((n) => n.key !== 'rieng').reduce((s, n) => s + n.count, 0);

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button className={`rounded-lg border px-2.5 py-1 text-sm ${nhom === '' ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-white'}`} onClick={() => setNhom('')}>
            Tất cả ({tong})
          </button>
          {nhomList
            .filter((n) => n.key !== 'rieng')
            .map((n) => (
              <button
                key={n.key}
                className={`rounded-lg border px-2.5 py-1 text-sm ${nhom === n.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-white'}`}
                onClick={() => setNhom(n.key)}
              >
                {n.label} ({n.count})
              </button>
            ))}
        </div>
        <div className="flex gap-2">
          <input className="input" placeholder="Tìm trong kho (vd: màu thương hiệu, CON05, Savax…)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tai()} />
          <AsyncButton className="btn-primary whitespace-nowrap" onClick={tai} busyLabel="…">
            Tìm
          </AsyncButton>
        </div>
      </div>

      <div className="card">
        {items === null ? (
          <SkeletonRows rows={4} />
        ) : items.length === 0 ? (
          <EmptyState icon="🧠" text={q || nhom ? 'Chưa có mục nào khớp.' : 'Kho chưa có mục nào. Vào tab "Đóng góp" để thêm mục đầu tiên.'} />
        ) : (
          <ul className="divide-y">
            {items.map((i) => (
              <DongMuc key={i.id} i={i} nhom={tenNhom} onOpen={() => setMo(i)} />
            ))}
          </ul>
        )}
      </div>
      {mo && <PopupMuc item={mo} nhomList={nhomList} isDirector={isDirector} onClose={() => setMo(null)} onSaved={() => { tai(); onChanged(); }} />}
    </div>
  );
}

// ── Tab Khách hàng (thay mục Lưu ý KH) ──

interface Profile {
  key: string;
  customer: string;
  summary: string;
  builtAt: string;
}

export function TabKhach({ nhomList, isDirector, onChanged }: { nhomList: Nhom[]; isDirector: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [khach, setKhach] = useState<Array<{ id: string; name: string; count: number }> | null>(null);
  const [loc, setLoc] = useState('');
  const [chon, setChon] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<BrainItem[]>([]);
  const [hoSo, setHoSo] = useState<Profile | null>(null);
  const [ghi, setGhi] = useState('');
  const [mo, setMo] = useState<BrainItem | null>(null);
  const tenNhom = useMemo(() => new Map(nhomList.map((n) => [n.key, n.label])), [nhomList]);

  async function taiKhach() {
    setKhach((await api<{ customers: Array<{ id: string; name: string; count: number }> }>('/brain/customers')).customers);
  }
  async function taiMuc(k: { id: string; name: string }) {
    const [r, p] = await Promise.all([
      api<{ items: BrainItem[] }>(`/brain/items?customerId=${encodeURIComponent(k.id)}`),
      api<{ profiles: Profile[] }>('/brain/profiles').catch(() => ({ profiles: [] as Profile[] })),
    ]);
    setItems(r.items);
    const key = k.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    setHoSo(p.profiles.find((x) => x.key === key || x.customer === k.name) || null);
  }
  useEffect(() => {
    taiKhach().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (chon) taiMuc(chon).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chon]);

  async function themGhiChu() {
    if (!chon) return;
    if (ghi.trim().length < 10) return toast.error('Viết rõ hơn một chút (ít nhất 10 ký tự).');
    try {
      const r = await api<{ message: string }>('/brain/items', { body: { title: `Lưu ý khách hàng: ${chon.name}`, body: ghi.trim(), customer: chon.name } });
      toast.success(r.message);
      setGhi('');
      await Promise.all([taiMuc(chon), taiKhach()]);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const ds = (khach || []).filter((k) => !loc.trim() || k.name.toLowerCase().includes(loc.trim().toLowerCase()));

  if (chon) {
    return (
      <div className="space-y-3">
        <div className="card">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">👤 {chon.name}</h2>
            <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setChon(null)}>
              ← Danh sách khách
            </button>
          </div>
          {hoSo?.summary && (
            <div className="mt-2 rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
              <div className="mb-1 text-xs font-medium text-ink-muted">📋 Hồ sơ tổng hợp (AI · {fmtD(hoSo.builtAt)})</div>
              <p className="whitespace-pre-wrap">{hoSo.summary}</p>
            </div>
          )}
        </div>
        <div className="card space-y-2">
          <label className="label" htmlFor="ghi-khach">
            Thêm điều cần nhớ về khách này
          </label>
          <textarea
            id="ghi-khach"
            className="input min-h-[6rem]"
            placeholder="vd: Chị thích tông pastel, không dùng chữ đỏ; duyệt bài vào tối thứ 5…"
            value={ghi}
            onChange={(e) => setGhi(e.target.value)}
          />
          <AsyncButton className="btn-primary" onClick={themGhiChu} busyLabel="AI đang xếp…">
            ＋ Lưu vào kho
          </AsyncButton>
        </div>
        <div className="card">
          <h3 className="mb-1 font-medium">Tri thức về khách ({items.length})</h3>
          {items.length === 0 ? (
            <EmptyState icon="🗂" text="Chưa có mục nào về khách này." />
          ) : (
            <ul className="divide-y">
              {items.map((i) => (
                <DongMuc key={i.id} i={i} nhom={tenNhom} onOpen={() => setMo(i)} />
              ))}
            </ul>
          )}
        </div>
        {mo && <PopupMuc item={mo} nhomList={nhomList} isDirector={isDirector} onClose={() => setMo(null)} onSaved={() => chon && taiMuc(chon)} />}
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <input className="input" placeholder="Tìm khách…" value={loc} onChange={(e) => setLoc(e.target.value)} />
      {khach === null ? (
        <SkeletonRows rows={5} />
      ) : ds.length === 0 ? (
        <EmptyState icon="👤" text="Không có khách nào khớp." />
      ) : (
        <ul className="divide-y">
          {ds.map((k) => (
            <li key={k.id}>
              <button className="flex w-full items-center justify-between gap-2 py-2 text-left" onClick={() => setChon(k)}>
                <span className="font-medium">{k.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">{k.count ? `${k.count} mục` : 'chưa có'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tab Đóng góp ──

export function TabGopY({ nhomList, onChanged }: { nhomList: Nhom[]; onChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', body: '', customer: '' });
  const [ketQua, setKetQua] = useState<{ message: string; item: BrainItem | null } | null>(null);
  const [cuaToi, setCuaToi] = useState<BrainItem[]>([]);
  const tenNhom = useMemo(() => new Map(nhomList.map((n) => [n.key, n.label])), [nhomList]);

  async function taiCuaToi() {
    setCuaToi((await api<{ items: BrainItem[] }>('/brain/items?mine=1')).items);
  }
  useEffect(() => {
    taiCuaToi().catch(() => undefined);
  }, []);

  async function gui() {
    if (!f.title.trim()) return toast.error('Nhập tiêu đề.');
    if (f.body.trim().length < 10) return toast.error('Nội dung quá ngắn.');
    try {
      const r = await api<{ message: string; item: BrainItem | null }>('/brain/items', { body: f });
      setKetQua(r);
      if (r.item && r.item.status !== 'rejected') setF({ title: '', body: '', customer: '' });
      await taiCuaToi();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <h2 className="font-semibold">✍️ Đóng góp vào kho</h2>
        <p className="text-sm text-ink-muted">
          Viết một điều cả công ty nên biết: quy trình, tiêu chuẩn thiết kế, cách xử lý một tình huống, lưu ý về khách… AI sẽ đọc,
          xếp nhóm, gắn đúng khách và quyết định ai xem được.
        </p>
        <input className="input" placeholder="Tiêu đề, vd: Màu sắc thương hiệu MT Digital" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input min-h-[10rem]" placeholder="Nội dung — viết đủ để người khác đọc là làm theo được." value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <input className="input" placeholder="Khách hàng liên quan (nếu có)" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} />
        <AsyncButton className="btn-primary" onClick={gui} busyLabel="AI đang đọc…">
          Gửi vào kho
        </AsyncButton>
        {ketQua && (
          <div className={`rounded-xl px-3 py-2 text-sm ${ketQua.item?.status === 'published' ? 'bg-emerald-50 text-emerald-800' : ketQua.item?.status === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'}`}>
            {ketQua.message}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mb-1 font-medium">Đóng góp của tôi ({cuaToi.length})</h3>
        {cuaToi.length === 0 ? (
          <EmptyState icon="✍️" text="Bạn chưa gửi mục nào." />
        ) : (
          <ul className="divide-y">
            {cuaToi.map((i) => (
              <li key={i.id} className="py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={TRANG_THAI[i.status].variant}>{TRANG_THAI[i.status].label}</Badge>
                  <Badge variant="info">{tenNhom.get(i.category) || i.category}</Badge>
                  {i.customer && <Badge variant="success">{i.customer}</Badge>}
                </div>
                <div className="mt-1 font-medium">{i.title}</div>
                {i.aiReason && i.status !== 'published' && <div className="text-xs text-ink-muted">Lý do: {i.aiReason}</div>}
                <div className="text-xs text-ink-faint">{fmtD(i.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Tab Chờ duyệt / Riêng anh (giám đốc) ──

export function TabDanhSach({ status, category, nhomList, rong, onChanged }: { status: string; category?: string; nhomList: Nhom[]; rong: string; onChanged: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<BrainItem[] | null>(null);
  const [mo, setMo] = useState<BrainItem | null>(null);
  const [trang, setTrang] = useState(1);
  // Tích chọn để ban hành / bỏ hàng loạt (anh Tâm 10/10/2026).
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [dangLam, setDangLam] = useState('');
  const tenNhom = useMemo(() => new Map(nhomList.map((n) => [n.key, n.label])), [nhomList]);
  const CO = 20;
  const duyet = status === 'pending';

  async function tai() {
    const p = new URLSearchParams({ status });
    if (category) p.set('category', category);
    const ds = (await api<{ items: BrainItem[] }>(`/brain/items?${p}`)).items;
    setItems(ds);
    // Bỏ tích những mục không còn trong danh sách; lùi trang nếu trang hiện tại đã trống.
    const con = new Set(ds.map((i) => i.id));
    setChon((cu) => new Set([...cu].filter((id) => con.has(id))));
    setTrang((t) => Math.min(t, Math.max(1, Math.ceil(ds.length / CO))));
  }
  useEffect(() => {
    setTrang(1);
    setChon(new Set());
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category]);

  async function nhanh(i: BrainItem, st: BrainItem['status']) {
    try {
      await api(`/brain/items/${i.id}`, { method: 'PATCH', body: { status: st } });
      toast.success(st === 'published' ? 'Đã ban hành' : 'Đã bỏ');
      await tai();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Ban hành / bỏ các mục đã tích. Máy chủ làm ~40 giây mỗi lượt; còn thì gọi tiếp. */
  async function hangLoat(st: 'published' | 'rejected') {
    let ids = [...chon];
    if (!ids.length) return;
    if (st === 'rejected' && !window.confirm(`Không lưu ${ids.length} mục đã chọn?`)) return;
    let xong = 0;
    const loi: string[] = [];
    try {
      for (let lan = 0; ids.length && lan < 10; lan++) {
        setDangLam(`${st === 'published' ? 'Đang ban hành' : 'Đang bỏ'} ${xong}/${chon.size}…`);
        const r = await api<{ xong: number; loi: string[]; conLai: string[] }>('/brain/items/bulk', { body: { ids, status: st } });
        xong += r.xong;
        loi.push(...r.loi);
        ids = r.conLai;
      }
      if (loi.length) toast.error(`${loi.length} mục lỗi: ${loi[0]}`);
      toast.success(`${st === 'published' ? 'Đã ban hành' : 'Đã bỏ'} ${xong} mục`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDangLam('');
      setChon(new Set());
      await tai().catch(() => undefined);
      onChanged();
    }
  }

  const tong = items?.length || 0;
  const trangNay = (items || []).slice((trang - 1) * CO, trang * CO);
  const tichHetTrang = trangNay.length > 0 && trangNay.every((i) => chon.has(i.id));
  const doiChon = (id: string, co: boolean) =>
    setChon((cu) => {
      const m = new Set(cu);
      if (co) m.add(id);
      else m.delete(id);
      return m;
    });

  return (
    <div className="card">
      {duyet && tong > 0 && (
        <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={tichHetTrang}
              onChange={(e) => trangNay.forEach((i) => doiChon(i.id, e.target.checked))}
            />
            Chọn cả trang
          </label>
          {chon.size < tong && (
            <button className="text-brand-600 underline" onClick={() => setChon(new Set((items || []).map((i) => i.id)))}>
              Chọn tất cả {tong}
            </button>
          )}
          {chon.size > 0 && (
            <>
              <span className="text-ink-muted">· đã chọn {chon.size}</span>
              <button className="text-ink-muted underline" onClick={() => setChon(new Set())}>
                Bỏ chọn
              </button>
              <div className="ml-auto flex flex-wrap gap-2">
                {dangLam ? (
                  <span className="text-ink-soft">{dangLam}</span>
                ) : (
                  <>
                    <button className="btn-primary px-3 py-1 text-sm" onClick={() => hangLoat('published')}>
                      ✓ Ban hành {chon.size} mục
                    </button>
                    <button className="btn-ghost px-3 py-1 text-sm text-rose-600" onClick={() => hangLoat('rejected')}>
                      Không lưu {chon.size} mục
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {items === null ? (
        <SkeletonRows rows={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="✅" text={rong} />
      ) : (
        <ul className="divide-y">
          {trangNay.map((i) => (
            <li key={i.id} className={`flex gap-2 py-2 ${chon.has(i.id) ? 'bg-brand-50/60' : ''}`}>
              {duyet && (
                <input
                  type="checkbox"
                  className="mt-1.5 h-4 w-4 shrink-0"
                  aria-label={`Chọn ${i.title}`}
                  checked={chon.has(i.id)}
                  onChange={(e) => doiChon(i.id, e.target.checked)}
                />
              )}
              <div className="min-w-0 flex-1">
              <button className="w-full text-left" onClick={() => setMo(i)}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="info">{tenNhom.get(i.category) || i.category}</Badge>
                  {i.customer && <Badge variant="success">{i.customer}</Badge>}
                  <Badge variant="neutral">{tenPhamVi(i.scope)}</Badge>
                </div>
                <div className="mt-1 font-medium">{i.title}</div>
                {i.summary && <div className="text-sm text-ink-muted">{i.summary}</div>}
                {i.aiReason && <div className="text-xs text-ink-muted">🤖 {i.aiReason}</div>}
                <div className="text-xs text-ink-faint">
                  {i.submittedName || 'Hệ thống'} · {fmtD(i.createdAt)}
                </div>
              </button>
              {status === 'pending' && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <AsyncButton className="btn-primary px-3 py-1 text-sm" onClick={() => nhanh(i, 'published')} busyLabel="…">
                    ✓ Ban hành
                  </AsyncButton>
                  <button className="btn-ghost px-3 py-1 text-sm" onClick={() => setMo(i)}>
                    Sửa nhãn
                  </button>
                  <AsyncButton className="btn-ghost px-3 py-1 text-sm text-rose-600" onClick={() => nhanh(i, 'rejected')} busyLabel="…">
                    Không lưu
                  </AsyncButton>
                </div>
              )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <PhanTrang trang={trang} tong={tong} co={CO} onDoi={setTrang} />
      {mo && <PopupMuc item={mo} nhomList={nhomList} isDirector onClose={() => setMo(null)} onSaved={() => { tai(); onChanged(); }} />}
    </div>
  );
}

// ── Tab Câu hỏi chưa có lời giải (giám đốc) ──

export function TabCauHoi({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [ds, setDs] = useState<Question[] | null>(null);
  const [traLoi, setTraLoi] = useState<Record<string, string>>({});

  async function tai() {
    setDs((await api<{ questions: Question[] }>('/brain/questions')).questions);
  }
  useEffect(() => {
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function gui(x: Question) {
    const a = (traLoi[x.id] || '').trim();
    if (a.length < 5) return toast.error('Viết câu trả lời rõ hơn.');
    try {
      const r = await api<{ message: string }>(`/brain/questions/${x.id}/answer`, { body: { answer: a } });
      toast.success(`Đã trả lời — ${r.message}`);
      await tai();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function boQua(x: Question) {
    if (!window.confirm('Bỏ qua câu hỏi này (không trả lời)?')) return;
    await api(`/brain/questions/${x.id}/dismiss`, { body: {} }).catch((e) => toast.error((e as Error).message));
    await tai();
    onChanged();
  }

  return (
    <div className="card">
      <p className="mb-2 text-sm text-ink-muted">
        Nhân viên hỏi trợ lý mà kho chưa có lời giải. Anh trả lời một lần — câu trả lời vào kho, người hỏi được báo lại, lần sau ai hỏi cũng có.
      </p>
      {ds === null ? (
        <SkeletonRows rows={3} />
      ) : ds.length === 0 ? (
        <EmptyState icon="🎉" text="Không có câu hỏi nào đang chờ." />
      ) : (
        <ul className="divide-y">
          {ds.map((x) => (
            <li key={x.id} className="space-y-2 py-3">
              <div>
                <div className="font-medium">❓ {x.question}</div>
                <div className="text-xs text-ink-faint">
                  {x.askedName || '?'}
                  {x.teamId ? ` · ${x.teamId}` : ''} · {fmtD(x.createdAt)}
                  {x.times > 1 ? ` · ${x.times} lần hỏi` : ''}
                </div>
              </div>
              <textarea
                className="input min-h-[5rem]"
                placeholder="Câu trả lời của anh…"
                value={traLoi[x.id] || ''}
                onChange={(e) => setTraLoi({ ...traLoi, [x.id]: e.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <AsyncButton className="btn-primary px-3 py-1 text-sm" onClick={() => gui(x)} busyLabel="Đang lưu…">
                  Trả lời & đưa vào kho
                </AsyncButton>
                <button className="btn-ghost px-3 py-1 text-sm" onClick={() => boQua(x)}>
                  Bỏ qua
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Dọn kho cũ (giám đốc) ──

export function DonKhoCu({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [dem, setDem] = useState<{ chuaPhanLoai: number; luuYChuaChuyen: number } | null>(null);
  const [dangChay, setDangChay] = useState('');

  async function tai() {
    setDem(await api<{ chuaPhanLoai: number; luuYChuaChuyen: number }>('/brain/cleanup'));
  }
  useEffect(() => {
    tai().catch(() => undefined);
  }, []);

  /** Máy chủ chỉ sống 60 giây mỗi lượt → chạy từng lô, lặp tới khi còn 0. */
  async function chay(path: string, nhan: string) {
    setDangChay(nhan);
    try {
      for (let lan = 0; lan < 40; lan++) {
        const r = await api<{ done: number; remaining: number }>(path, { body: {} });
        await tai();
        if (r.remaining === 0 || r.done === 0) break;
      }
      toast.success(`${nhan}: xong`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDangChay('');
    }
  }

  if (!dem || (dem.chuaPhanLoai === 0 && dem.luuYChuaChuyen === 0)) return null;
  return (
    <div className="card border-amber-200 bg-amber-50 space-y-2">
      <div className="font-semibold text-amber-900">🧹 Dọn kho cũ</div>
      {dem.chuaPhanLoai > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
          <span>{dem.chuaPhanLoai} mục cũ (AI tự lưu từ chat / lưu tay) chưa được phân loại — đang ẩn khỏi nhân viên.</span>
          <button className="btn-primary px-3 py-1 text-sm" disabled={!!dangChay} onClick={() => chay('/brain/reclassify', 'Phân loại lại kho')}>
            {dangChay === 'Phân loại lại kho' ? 'Đang phân loại…' : 'Phân loại lại kho'}
          </button>
        </div>
      )}
      {dem.luuYChuaChuyen > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
          <span>{dem.luuYChuaChuyen} Lưu ý KH chưa chuyển vào kho (nhóm Khách hàng).</span>
          <button className="btn-primary px-3 py-1 text-sm" disabled={!!dangChay} onClick={() => chay('/brain/migrate-customer-notes', 'Chuyển Lưu ý KH')}>
            {dangChay === 'Chuyển Lưu ý KH' ? 'Đang chuyển…' : 'Chuyển vào kho'}
          </button>
        </div>
      )}
      <p className="text-xs text-amber-800">Mục công việc sẽ mở lại cho nhân viên; lịch trình, phân tích nhân sự giữ riêng anh; điều chưa chắc vào tab Chờ duyệt.</p>
    </div>
  );
}
