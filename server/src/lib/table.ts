// Chuyển dữ liệu dạng bảng (Google Sheet / CSV / Excel xuất CSV) thành văn bản cho AI.
//
// Vì sao không đổ thẳng bảng vào kho: cắt bảng thô thành đoạn sẽ làm ĐỨT quan hệ hàng–cột —
// đoạn chứa "21/7" có thể không còn tiêu đề cột nào bên cạnh. Nên mỗi HÀNG được viết thành
// một dòng tự chứa, kèm tên cột; cắt đoạn kiểu gì mỗi dòng vẫn hiểu được.

/** Tách ID + gid từ link Google Sheets. Trả null nếu không phải link Sheets. */
export function parseSheetUrl(url: string): { id: string; gid: string } | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(String(url || ''));
  if (!m) return null;
  const gidMatch = /[#&?]gid=(\d+)/.exec(url);
  return { id: m[1]!, gid: gidMatch?.[1] || '0' };
}

/** Link tải CSV công khai của một sheet (cần share "Anyone with the link – Viewer"). */
export function sheetCsvUrl(id: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/** Hàng có ít nhất một ô có chữ? */
function hasContent(row: string[]): boolean {
  return row.some((c) => c.trim() !== '');
}

/**
 * Bảng → văn bản, mỗi hàng một dòng tự chứa: "Cột A: giá trị · Cột B: giá trị".
 * Hàng đầu được coi là tiêu đề cột. Ô rỗng bị bỏ để dòng khỏi loãng.
 */
export function rowsToLabeledText(rows: string[][], maxRows = 500): string {
  const clean = rows.filter(hasContent);
  if (clean.length === 0) return '';

  const header = clean[0]!.map((h) => h.trim());
  const body = clean.slice(1, maxRows + 1);
  // Chỉ coi hàng đầu là tiêu đề khi nó có ít nhất 2 cột CÓ CHỮ và bên dưới còn hàng dữ liệu.
  // Bảng một hàng mà coi là tiêu đề thì mất sạch nội dung — thà nối thô còn hơn.
  const useHeader = header.filter(Boolean).length >= 2 && body.length > 0;
  if (!useHeader) {
    return clean.map((r) => r.map((c) => c.trim()).filter(Boolean).join(' · ')).join('\n');
  }

  const lines = body.map((r) =>
    r
      .map((cell, i) => {
        const v = cell.trim();
        if (!v) return '';
        const label = header[i]?.trim();
        return label ? `${label}: ${v}` : v;
      })
      .filter(Boolean)
      .join(' · '),
  );
  const more = clean.length - 1 > body.length ? `\n… và ${clean.length - 1 - body.length} hàng nữa.` : '';
  return `Các cột: ${header.filter(Boolean).join(', ')}\n${lines.filter(Boolean).join('\n')}${more}`;
}
