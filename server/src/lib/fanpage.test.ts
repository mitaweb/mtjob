import { describe, it, expect } from 'vitest';
import { binhLuanCanXet } from './fanpage.js';

// Javis mục 8 (anh Tâm 11/11/2026): AI soạn trả lời bình luận Fanpage, anh duyệt mới đăng. Dữ liệu GIẢ.
const feed = {
  data: [
    {
      id: 'P_1',
      message: 'Ưu đãi gói chăm sóc Fanpage tháng 11',
      comments: {
        data: [
          { id: 'C1', message: 'Giá gói này bao nhiêu ạ?', from: { id: 'U1', name: 'Lan' }, created_time: '2026-11-10T03:00:00+0000' },
          { id: 'C2', message: 'Cảm ơn chị, em inbox nhé', from: { id: 'PAGE', name: 'MT Digital' }, created_time: '2026-11-10T04:00:00+0000' },
          {
            id: 'C3',
            message: 'Có làm SEO không?',
            from: { id: 'U2', name: 'Hùng' },
            created_time: '2026-11-10T05:00:00+0000',
            comments: { data: [{ id: 'C3r', from: { id: 'PAGE' } }] },
          },
          { id: 'C4', message: 'Cũ quá rồi', from: { id: 'U3', name: 'An' }, created_time: '2026-10-01T05:00:00+0000' },
          { id: 'C5', message: '', from: { id: 'U4', name: 'Bình' }, created_time: '2026-11-10T06:00:00+0000' },
          { id: 'C6', message: 'Đã xét rồi', from: { id: 'U5', name: 'Cúc' }, created_time: '2026-11-10T06:00:00+0000' },
        ],
      },
    },
  ],
};

describe('binhLuanCanXet — bình luận nào cần AI xét trả lời', () => {
  it('bỏ bình luận của chính Trang, đã được Trang trả lời, quá cũ, trống, đã xét', () => {
    const ds = binhLuanCanXet(feed, 'PAGE', new Set(['C6']), Date.parse('2026-11-03T00:00:00Z'));
    expect(ds.map((x) => x.id)).toEqual(['C1']);
    expect(ds[0]).toMatchObject({ noiDung: 'Giá gói này bao nhiêu ạ?', nguoi: 'Lan', baiId: 'P_1', bai: 'Ưu đãi gói chăm sóc Fanpage tháng 11' });
  });
  it('feed hỏng thì rỗng', () => {
    expect(binhLuanCanXet({}, 'PAGE', new Set(), 0)).toEqual([]);
  });
});
