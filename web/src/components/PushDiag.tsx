import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { currentEndpoint, showLocalTest, swStatus } from '../lib/push';
import AsyncButton from './AsyncButton';

// Khối tự chẩn thông báo đẩy.
//
// Anh Tâm 1/8/2026: "vẫn chưa nhận được thông báo nào". Trước đây không có cách nào biết
// hỏng ở khâu nào — máy chủ chưa cấu hình khoá, thiết bị chưa đăng ký, hay dịch vụ đẩy
// từ chối. Khối này trả lời cả ba, ngay trên màn hình, không phải đọc log.

interface Diag {
  serverReady: boolean;
  subject: string;
  deviceCount: number;
  devices: Array<{ host: string; tail: string; ua: string; createdAt: string }>;
}

interface TestRes {
  ok: boolean;
  deviceCount: number;
  message: string;
  results: Array<{ tail: string; ok: boolean; status: number; error: string }>;
}

export default function PushDiag() {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [res, setRes] = useState<TestRes | null>(null);
  const [err, setErr] = useState('');
  const [myTail, setMyTail] = useState('');
  const [sw, setSw] = useState('');
  const [local, setLocal] = useState('');

  useEffect(() => {
    if (!open || diag) return;
    api<Diag>('/notifications/diag')
      .then(setDiag)
      .catch((e) => setErr((e as Error).message));
    currentEndpoint().then((ep) => setMyTail(ep.slice(-8)));
    swStatus().then(setSw);
  }, [open, diag]);

  async function guiThu() {
    setErr('');
    setRes(null);
    try {
      setRes(await api<TestRes>('/notifications/test', { method: 'POST' }));
      setDiag(null); // đăng ký chết đã bị dọn, tải lại cho khớp
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="text-xs text-slate-400 underline hover:text-slate-600" onClick={() => setOpen(true)}>
        Không nhận được thông báo? Kiểm tra tại đây
      </button>
    );
  }

  return (
    <div className="card space-y-2 border border-slate-200">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Kiểm tra thông báo đẩy</h2>
        <button className="text-xs text-slate-400 underline" onClick={() => setOpen(false)}>
          đóng
        </button>
      </div>

      {err && <p className="text-sm text-rose-600">⚠️ {err}</p>}

      {diag && (
        <div className="space-y-1 text-sm">
          <div>
            {diag.serverReady ? '✅' : '❌'} Máy chủ{' '}
            {diag.serverReady ? 'đã cấu hình khoá gửi' : 'CHƯA cấu hình khoá VAPID — báo kỹ thuật'}
          </div>
          <div>
            {diag.deviceCount > 0 ? '✅' : '❌'} Thiết bị đã đăng ký: <b>{diag.deviceCount}</b>
            {diag.deviceCount === 0 && (
              <span className="text-slate-500"> — bấm “🔔 Bật đẩy” ở trên trước đã</span>
            )}
          </div>
          {diag.devices.map((d) => (
            <div key={d.tail} className="pl-5 text-xs text-slate-500">
              · {d.host} …{d.tail}
              {d.tail === myTail && (
                <span className="ml-1 rounded bg-brand-100 px-1.5 py-0.5 font-medium text-brand-700">máy này</span>
              )}
              {d.ua && <span className="text-slate-400"> ({d.ua})</span>}
            </div>
          ))}
          <div className="pt-1 text-xs text-slate-400">
            Địa chỉ liên hệ gửi kèm: {diag.subject}
            {sw && <> · Bộ nhận thông báo: {sw}</>}
          </div>
        </div>
      )}

      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton className="btn-primary px-3 py-1 text-sm" busyLabel="Đang gửi…" onClick={guiThu}>
            1. Gửi thử qua máy chủ
          </AsyncButton>
          <span className="text-xs text-slate-500">Đi đúng đường như mọi thông báo khác.</span>
        </div>
        {/* Phép thử tách bạch: hiện thẳng tại máy, không qua mạng. So hai kết quả là biết
            hỏng ở đường đẩy hay ở quyền/cài đặt của chính máy này. */}
        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton
            className="btn-ghost px-3 py-1 text-sm"
            busyLabel="…"
            onClick={() => showLocalTest().then((r) => setLocal(`${r.ok ? '✅' : '❌'} ${r.message}`))}
          >
            2. Hiện thử ngay tại máy
          </AsyncButton>
          <span className="text-xs text-slate-500">Không qua máy chủ — để biết máy có chịu hiện không.</span>
        </div>
        {local && <div className="text-sm text-slate-700">{local}</div>}
      </div>

      {res && (
        <div className="rounded-xl bg-slate-50 p-2 text-sm">
          <div className={res.ok ? 'text-emerald-700' : 'text-rose-700'}>
            {res.ok ? '✅' : '❌'} {res.message}
          </div>
          {res.results.map((r) => (
            <div key={r.tail} className="mt-1 text-xs">
              …{r.tail}
              {r.tail === myTail && <span className="text-brand-700"> (máy này)</span>}:{' '}
              {r.ok ? <span className="text-emerald-600">gửi được</span> : (
                <span className="text-rose-600">
                  lỗi {r.status || '—'} · {r.error}
                </span>
              )}
            </div>
          ))}
          {res.ok && (
            <div className="mt-1.5 space-y-1.5 text-xs text-slate-500">
              <p>
                <b className="text-slate-700">Cả hai nút báo được mà màn hình vẫn im?</b> Nghĩa là máy chủ và
                đường truyền đều tốt — Windows đang chặn khâu HIỆN. Làm theo thứ tự:
              </p>
              <p>
                <b>1. Bấm Win + N</b> mở Trung tâm thông báo. Thấy thông báo MTJOB nằm trong đó thì mọi thứ
                đang chạy đúng, chỉ là banner không bật lên.
              </p>
              <p>
                <b>2. Tắt Hỗ trợ tập trung</b>: Cài đặt → Hệ thống → Thông báo → tắt “Không làm phiền” và mọi
                quy tắc tự động.
              </p>
              <p>
                <b>3. Bật thông báo cho Chrome</b>: cũng ở trang đó, tìm Google Chrome trong danh sách và bật
                lên, đồng thời bật “Hiện biểu ngữ thông báo”.
              </p>
              <p>
                <b>4. Chrome phải đang chạy</b> (còn trong khay hệ thống) mới nhận được thông báo lúc anh
                không mở app.
              </p>
              <p>
                <b>iPhone</b>: phải mở app từ biểu tượng đã “Thêm vào Màn hình chính”; và vào Cài đặt → Thông
                báo → MT DIGITAL bật Cho phép, chọn kiểu cảnh báo Biểu ngữ.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
