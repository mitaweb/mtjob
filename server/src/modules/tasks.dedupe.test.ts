import { describe, it, expect } from 'vitest';
import { pickDuplicates, type Row } from './tasks.dedupe.js';

// Luật này trừ thẳng vào điểm → thưởng → lương. Test bằng dữ liệu THẬT lấy từ màn hình
// chi tiết công việc của Thảo Nhiên ngày 23/07/2026, chứ không phải ví dụ tự nghĩ ra.

let seq = 0;
function row(p: Partial<Row> & { note: string; task_name: string; points: number }): Row {
  seq += 1;
  return {
    task_id: `T-${seq}`,
    member_id: 'M-1',
    member_name: 'Lê Nguyễn Thảo Nhiên',
    task_code: p.task_code ?? 'TASK',
    task_name: p.task_name,
    note: p.note,
    points: p.points,
    started_at: p.started_at ?? '',
    completed_at: p.completed_at ?? '2026-07-23T10:00:00.000Z',
    created_at: p.created_at ?? `2026-07-23T10:0${seq % 10}:00.000Z`,
  };
}

describe('pickDuplicates', () => {
  it('bỏ câu báo bắt đầu bị tính điểm, giữ lại dòng báo xong thật', () => {
    // Ngày 23/07: 3 dòng "Tối ưu Quảng Cáo" + 5 dòng "bắt đầu tối ưu quảng cáo", đều +35đ.
    const rows = [
      ...Array.from({ length: 3 }, () => row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: '', points: 35 })),
      ...Array.from({ length: 5 }, () =>
        row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: 'bắt đầu tối ưu quảng cáo', points: 35 }),
      ),
    ];
    const r = pickDuplicates(rows);
    expect(r.totalTasks).toBe(5);
    expect(r.totalPoints).toBe(175);
    expect(r.items.every((i) => i.reason === 'câu báo bắt đầu bị tính điểm')).toBe(true);
    // Ba dòng báo xong thật phải còn nguyên.
    expect(r.items.filter((i) => i.note === '')).toEqual([]);
  });

  it('cặp "Lên Ads" + "bắt đầu lên ads" chỉ còn tính một lần', () => {
    const rows = [
      row({ task_code: 'LA', task_name: 'Lên Ads', note: '', points: 20 }),
      row({ task_code: 'LA', task_name: 'Lên Ads', note: 'bắt đầu lên ads', points: 20 }),
    ];
    const r = pickDuplicates(rows);
    expect(r.totalTasks).toBe(1);
    expect(r.totalPoints).toBe(20);
    expect(r.items[0].note).toBe('bắt đầu lên ads');
  });

  it('KHÔNG đụng tới việc lặp lại thật (2 lần Báo cáo Ads, không dòng nào báo bắt đầu)', () => {
    const rows = [
      row({ task_code: 'BC', task_name: 'Báo cáo Ads', note: '', points: 35 }),
      row({ task_code: 'BC', task_name: 'Báo cáo Ads', note: '', points: 35 }),
    ];
    expect(pickDuplicates(rows).totalTasks).toBe(0);
  });

  it('bỏ câu báo bắt đầu dù nó ĐỨNG MỘT MÌNH trong ngày', () => {
    // Ca thật ngày 22/07: "bắt đầu chuẩn bị nội dung quảng cáo" +25đ, không có dòng nào
    // khác cùng loại. Điểm ghi ở lúc kết thúc nên dòng này không được có điểm.
    const rows = [
      row({ task_code: 'CB', task_name: 'Chuẩn bị nội dung quảng cáo', note: 'bắt đầu chuẩn bị nội dung quảng cáo', points: 25 }),
    ];
    const r = pickDuplicates(rows);
    expect(r.totalTasks).toBe(1);
    expect(r.totalPoints).toBe(25);
  });

  it('bỏ cả nhóm toàn câu báo bắt đầu, không cần có dòng báo xong để đối chiếu', () => {
    // Ca thật ngày 22/07: "bắt đầu lên ads" ×2, mỗi dòng +20đ, không có dòng "Lên Ads" nào.
    const rows = [
      row({ task_code: 'LA', task_name: 'Lên Ads', note: 'bắt đầu lên ads', points: 20 }),
      row({ task_code: 'LA', task_name: 'Lên Ads', note: 'bắt đầu lên ads', points: 20 }),
    ];
    const r = pickDuplicates(rows);
    expect(r.totalTasks).toBe(2);
    expect(r.totalPoints).toBe(40);
  });

  it('GIỮ việc thật đã bấm nút Bắt đầu rồi Kết thúc, dù ghi chú còn chữ "bắt đầu"', () => {
    // Có giờ bắt đầu = việc có thật, có giờ làm thật. Xoá đi là nhân sự mất công.
    // Nhãn xấu thì sửa bằng relabelStartNotes, không phải bằng cách trừ điểm.
    const rows = [
      row({
        task_code: 'LA',
        task_name: 'Lên Ads',
        note: 'bắt đầu lên ads',
        points: 20,
        started_at: '2026-07-23T02:00:00.000Z',
      }),
      row({
        task_code: 'LA',
        task_name: 'Lên Ads',
        note: 'bắt đầu lên ads',
        points: 20,
        started_at: '2026-07-23T04:00:00.000Z',
      }),
    ];
    expect(pickDuplicates(rows).totalTasks).toBe(0);
  });

  it('dòng bấm nút + dòng báo thẳng cùng một việc → bỏ dòng báo thẳng, giữ dòng có giờ làm', () => {
    const rows = [
      row({
        task_code: 'LA',
        task_name: 'Lên Ads',
        note: 'bắt đầu lên ads',
        points: 20,
        started_at: '2026-07-23T02:00:00.000Z',
      }),
      row({ task_code: 'LA', task_name: 'Lên Ads', note: '', points: 20 }),
    ];
    const r = pickDuplicates(rows);
    expect(r.totalTasks).toBe(1);
    expect(r.items[0].reason).toBe('báo thẳng trùng dòng đã bắt đầu');
    expect(r.items[0].note).toBe(''); // giữ lại dòng có giờ bắt đầu
  });

  it('mỗi dòng chỉ bị đếm thừa MỘT lần dù khớp cả hai kiểu', () => {
    // Có dòng đã bấm bắt đầu + dòng báo bắt đầu bị tính điểm + dòng báo xong thẳng.
    const rows = [
      row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: '', points: 35, started_at: '2026-07-23T01:00:00.000Z' }),
      row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: 'bắt đầu tối ưu quảng cáo', points: 35 }),
      row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: '', points: 35 }),
    ];
    const r = pickDuplicates(rows);
    expect(new Set(r.items.map((i) => i.id)).size).toBe(r.items.length);
    expect(r.totalTasks).toBe(2); // 1 câu báo bắt đầu + 1 báo thẳng trùng dòng đã bắt đầu
    expect(r.totalPoints).toBe(70);
  });

  it('khác khách thì không gom chung — hai việc thật cho hai khách vẫn tính đủ', () => {
    // Nếu gom nhầm, dòng báo thẳng của Y Salon sẽ bị coi là trùng với dòng đã bấm nút
    // của X Spa, và Y Salon mất điểm oan.
    const rows = [
      row({
        task_code: 'TU',
        task_name: 'Tối ưu Quảng Cáo',
        note: 'X Spa',
        points: 35,
        started_at: '2026-07-23T02:00:00.000Z',
      }),
      row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: 'Y Salon', points: 35 }),
    ];
    expect(pickDuplicates(rows).totalTasks).toBe(0);
  });

  it('khác ngày thì không gom chung', () => {
    const rows = [
      row({
        task_code: 'TU',
        task_name: 'Tối ưu Quảng Cáo',
        note: '',
        points: 35,
        started_at: '2026-07-22T02:00:00.000Z',
        completed_at: '2026-07-22T10:00:00.000Z',
      }),
      row({ task_code: 'TU', task_name: 'Tối ưu Quảng Cáo', note: '', points: 35, completed_at: '2026-07-23T10:00:00.000Z' }),
    ];
    expect(pickDuplicates(rows).totalTasks).toBe(0);
  });

  it('gộp điểm theo từng người để đối chiếu với bảng xếp hạng', () => {
    const rows = [
      row({ task_code: 'LA', task_name: 'Lên Ads', note: '', points: 20 }),
      row({ task_code: 'LA', task_name: 'Lên Ads', note: 'bắt đầu lên ads', points: 20 }),
    ];
    expect(pickDuplicates(rows).byMember).toEqual([
      { memberName: 'Lê Nguyễn Thảo Nhiên', tasks: 1, points: 20 },
    ]);
  });
});
