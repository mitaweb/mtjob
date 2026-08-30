export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Danh sách model hiện ra trong ô chọn.
 *
 * `daGo` = người dùng vừa GÕ để tìm. Chưa gõ thì trả về ĐỦ danh sách, kể cả khi ô đang
 * chứa sẵn tên model hiện tại.
 *
 * Đây đúng là chỗ <datalist> làm hỏng: nó luôn lọc theo nội dung trong ô, mà ô thì luôn
 * có sẵn tên model đang dùng — nên bấm mũi tên chỉ ra đúng một dòng, tưởng là mất danh
 * sách (anh Tâm 21/8/2026).
 */
export function locModel(models: ModelOption[], draft: string, daGo: boolean): ModelOption[] {
  const q = draft.trim().toLowerCase();
  if (!daGo || !q) return models;
  return models.filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(q));
}
