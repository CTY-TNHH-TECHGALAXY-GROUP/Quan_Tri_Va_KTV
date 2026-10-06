// Chữ hiển thị cho form "Tạo đơn nhanh" — phần hồ sơ khách & hoá đơn VAT.
export const t = {
    selectedCustomer: (name: string) => `Đã chọn hồ sơ: ${name}`,
    clearSelectedCustomer: 'Bỏ chọn',
    selectedCustomerHint: 'Đơn sẽ gắn thẳng vào hồ sơ này. Sửa tên hoặc liên hệ sẽ bỏ chọn.',

    vatToggle: 'Xuất hoá đơn VAT công ty',
    vatHint: 'Nhập mã số thuế rồi Tra cứu để tự điền tên và địa chỉ, hoặc gõ tay. Chưa có mã số thuế thì để trống, đơn vẫn được đánh dấu cần VAT.',
    taxCode: 'Mã số thuế',
    taxCodePlaceholder: '0316794479 hoặc 0316794479-001',
    taxCodeInvalid: 'Mã số thuế gồm 10 số, hoặc 10 số + 3 số chi nhánh.',
    lookup: 'Tra cứu',
    looking: 'Đang tra…',
    lookupFailed: 'Không tra được mã số thuế này. Kiểm tra lại hoặc nhập tay.',
    companyName: 'Tên công ty',
    companyNamePlaceholder: 'CÔNG TY TNHH …',
    companyAddress: 'Địa chỉ công ty',
    companyAddressPlaceholder: 'Số nhà, đường, phường, quận, tỉnh/thành',
    companyEmail: 'Email nhận hoá đơn',
    companyEmailPlaceholder: 'ketoan@congty.vn',
    companyPhone: 'SĐT công ty',
    companyPhonePlaceholder: '028 1234 5678',
};
