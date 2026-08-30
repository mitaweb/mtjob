// Chốt chặn phân công thành viên vào dự án. Thuần, có test — khuôn theo lib/hr.ts.
//
// Đặt ở tầng thuần chứ không viết thẳng trong route: đây là luật quyền, và luật quyền
// mà không test được thì sớm muộn cũng có người nới ra lúc sửa việc khác.

export interface NguoiDuocPhanCong {
  teamId: string;
  role: string;
  active: boolean;
}

/**
 * Leader có được phân công người này vào dự án không?
 * Trả '' nếu được; câu tiếng Việt giải thích nếu không.
 *
 * @param leaderTeamId phòng của người đang bấm, LẤY TỪ HỒ SƠ của họ — không đọc từ body.
 * @param duAnCoKpiCuaPhong dự án có chỉ số nào của phòng đó không.
 */
export function phanCongBlock(
  leaderTeamId: string,
  nguoi: NguoiDuocPhanCong,
  duAnCoKpiCuaPhong: boolean,
): string {
  if (!leaderTeamId) return 'Bạn chưa thuộc phòng nào nên chưa phân công được.';
  if (!duAnCoKpiCuaPhong) {
    // Phân công vào dự án phòng mình không tham gia chỉ đẻ ra dòng thưởng 0đ và làm
    // người ta tưởng bị quỵt.
    return 'Dự án này chưa có chỉ số nào của phòng bạn nên chưa phân công được.';
  }
  if (nguoi.teamId !== leaderTeamId) return 'Chỉ phân công được người trong phòng của bạn.';
  if (!nguoi.active) return 'Người này đã nghỉ việc.';
  // Leader ăn thưởng qua đường riêng (teams.leader_member_id). Thêm vào danh sách thành
  // viên nữa là trả hai lần cho một người.
  if (nguoi.role === 'leader' || nguoi.role === 'director') {
    return 'Leader và giám đốc đã được tính thưởng riêng, không thêm vào danh sách thành viên.';
  }
  return '';
}
