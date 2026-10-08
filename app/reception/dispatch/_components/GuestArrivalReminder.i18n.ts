export const t = {
  title: 'Nhắc tắt Báo khách',
  message: (minutes: number, since: string, by: string) =>
    `Báo khách đã bật ${minutes} phút (từ ${since}${by ? `, bởi ${by}` : ''}). Còn khách đợi không?`,
  turnOff: 'Tắt Báo khách',
  keep: 'Vẫn còn khách',
};
