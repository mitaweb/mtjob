export interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
}

/** Sai số đủ tốt để dừng đo sớm — GPS thật thường đạt mức này trong vài giây. */
const DU_TOT_M = 50;
/** Chờ tối đa bao lâu để máy tìm được vị trí tốt hơn. */
const CHO_TOI_DA_MS = 8000;

/**
 * Lấy vị trí TỐT NHẤT trong vài giây, thay vì lấy đúng mẫu đầu tiên.
 *
 * Anh Tâm 3/8/2026: máy tính nối WiFi báo cách công ty 6121m dù đang ngồi ở văn phòng.
 * Máy tính không có chip GPS nên mẫu ĐẦU TIÊN gần như luôn là vị trí trạm nhà mạng, lệch
 * hàng km. Chờ thêm vài giây thì máy thường trả tiếp các mẫu chính xác hơn — lấy mẫu có
 * sai số nhỏ nhất là cải thiện thấy rõ mà không phải làm gì thêm.
 *
 * Trả kèm `accuracy` để máy chủ biết con số khoảng cách có đáng tin không.
 */
export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Thiết bị không hỗ trợ định vị GPS.'));
      return;
    }

    let totNhat: Coords | null = null;
    let xong = false;
    let watchId = -1;

    const ketThuc = () => {
      if (xong) return;
      xong = true;
      if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
      clearTimeout(hetGio);
      if (totNhat) resolve(totNhat);
      else reject(new Error('Không lấy được vị trí. Kiểm tra xem đã bật Định vị cho trình duyệt chưa.'));
    };

    const hetGio = setTimeout(ketThuc, CHO_TOI_DA_MS);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c: Coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
        };
        // Giữ mẫu có sai số nhỏ nhất; mẫu không báo sai số coi như tệ nhất.
        if (!totNhat || (c.accuracy > 0 && c.accuracy < totNhat.accuracy)) totNhat = c;
        if (totNhat.accuracy > 0 && totNhat.accuracy <= DU_TOT_M) ketThuc();
      },
      (err) => {
        // Có mẫu rồi thì lỗi giữa chừng không sao — cứ dùng mẫu đang có.
        if (totNhat) {
          ketThuc();
          return;
        }
        xong = true;
        clearTimeout(hetGio);
        if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
        reject(new Error(err.message || 'Không lấy được vị trí.'));
      },
      { enableHighAccuracy: true, timeout: CHO_TOI_DA_MS, maximumAge: 0 },
    );
  });
}
