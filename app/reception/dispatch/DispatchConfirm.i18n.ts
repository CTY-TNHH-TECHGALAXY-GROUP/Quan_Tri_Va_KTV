// Chữ hiển thị cho các popup xác nhận trên màn điều phối.
export const t = {
    removeLastKtv: (serviceName: string) =>
        `Không điều phối nhân viên nào cho "${serviceName}".\nĐưa dịch vụ về trạng thái Chờ điều phối?`,
    runningDurationChange: (lines: string[]) =>
        `Thay đổi thời gian điều phối cho nhân viên đã bắt đầu dịch vụ?\n\n${lines.map(l => `• ${l}`).join('\n')}\n\nNhân viên sẽ nhận thông báo giờ mới.`,
    runningDurationLine: (ktv: string, from: number, to: number) => `${ktv}: ${from} → ${to} phút`,
    removedBLine: (ktv: string) => `Bỏ lượt B (${ktv}) — chưa bắt đầu`,
    removedBAfterADoneLine: (ktv: string) => `Bỏ lượt B (${ktv}) — dịch vụ hoàn tất theo A`,
    removedBWarning: (ktv: string) => `Đã bỏ lượt B (${ktv}) · A làm đến hết thời lượng gán rồi hoàn tất`,
    durationSaved: 'Đã cập nhật thời lượng dịch vụ và gửi thông báo cho nhân viên.',
    removedBSaved: 'Đã bỏ lượt B và gửi thông báo cho nhân viên.',
    removedBAfterASaved: 'Đã bỏ lượt B, dịch vụ hoàn tất theo A. Đã gửi thông báo cho nhân viên.',
    notifyFailed: (lines: string[]) => `Đã lưu nhưng chưa gửi được thông báo:\n${lines.join('\n')}`,
    durationOutOfRange: (min: number, max: number) => `Thời lượng ${min}–${max} phút`,
    durationSaveFailed: (error: string) => `Chưa cập nhật được thời gian dịch vụ: ${error}`,
};
