import React from 'react';
import styles from './PrintableInvoice.module.css';

export interface InvoiceConfig {
    spaName: string;
    slogan: string;
    address: string;
    phone: string;
    hotline: string;
    note1: string;
    note2: string;
    logoUrl?: string;
}

interface PrintableInvoiceProps {
    config: InvoiceConfig;
}

export const PrintableInvoice = ({ config }: PrintableInvoiceProps) => {
    // Current date/time formatted
    const now = new Date();
    const formattedDate = now.toLocaleDateString('vi-VN');
    const formattedTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    return (
        <div className={styles.invoiceContainer}>
            <div className={styles.page}>
                <header className={styles.header}>
                    <div className={styles.brand}>
                        {config.logoUrl ? (
                            <img src={config.logoUrl} alt="Logo" className={styles.logoImage} />
                        ) : (
                            <h1>{config.spaName || 'ORIA SPA'}</h1>
                        )}
                        <p>{config.slogan || 'Wellness • Beauty • Therapy'}</p>
                    </div>
                    <div className={styles.invoiceTitle}>
                        <h2>HÓA ĐƠN</h2>
                    </div>
                </header>

                <section className={styles.content}>
                    <div className={styles.grid}>
                        <div className={styles.box}>
                            <h3>Thông tin Spa</h3>
                            <div className={styles.row}>
                                <div className={styles.label}>Tên đơn vị</div>
                                <div>{config.spaName || 'ORIA SPA'}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>Địa chỉ</div>
                                <div>{config.address || '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh'}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>Điện thoại</div>
                                <div>{config.phone || '0900 000 000'}</div>
                            </div>
                        </div>

                        <div className={styles.box}>
                            <h3>Thông tin hóa đơn</h3>
                            <div className={styles.row}>
                                <div className={styles.label}>Mã hóa đơn</div>
                                <div>HD-000123</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>Ngày</div>
                                <div>{formattedDate} · {formattedTime}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>Thanh toán</div>
                                <div>Thẻ / Chuyển khoản</div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.sectionTitle}>Thông tin khách hàng</div>
                    <div className={styles.box}>
                        <div className={styles.row}>
                            <div className={styles.label}>Họ và tên</div>
                            <div>Nguyễn Minh Anh</div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.label}>Số điện thoại</div>
                            <div>0987 654 321</div>
                        </div>
                        <div className={styles.row}>
                            <div className={styles.label}>Email</div>
                            <div>minhanh@example.com</div>
                        </div>
                    </div>
                    <div className={styles.customerDivider}></div>

                    <div className={styles.sectionTitle}>Chi tiết dịch vụ</div>
                    <table className={styles.invoiceTable}>
                        <thead>
                            <tr>
                                <th>STT</th>
                                <th>Dịch vụ</th>
                                <th>SL</th>
                                <th>Đơn giá</th>
                                <th>Thành tiền</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>1</td>
                                <td>
                                    <div className={styles.serviceName}>Massage Body 90 phút</div>
                                    <div className={styles.serviceNote}>Giá đã bao gồm VAT</div>
                                </td>
                                <td>1</td>
                                <td>1.080.000 ₫</td>
                                <td>1.080.000 ₫</td>
                            </tr>
                            <tr>
                                <td>2</td>
                                <td>
                                    <div className={styles.serviceName}>Chăm sóc da mặt 45 phút</div>
                                    <div className={styles.serviceNote}>Giá đã bao gồm VAT</div>
                                </td>
                                <td>1</td>
                                <td>420.000 ₫</td>
                                <td>420.000 ₫</td>
                            </tr>
                        </tbody>
                    </table>

                    <div className={styles.totals}>
                        <div className={styles.totalsCard}>
                            <div className={styles.totalLine}>
                                <span>Tạm tính</span>
                                <strong>1.500.000 ₫</strong>
                            </div>
                            <div className={styles.totalLine}>
                                <span>Giảm giá</span>
                                <strong>0 ₫</strong>
                            </div>
                            <div className={`${styles.totalLine} ${styles.grand}`}>
                                <span>Tổng thanh toán</span>
                                <span>1.500.000 ₫</span>
                            </div>
                            <div className={styles.vatNote}>
                                Giá dịch vụ và tổng thanh toán đã bao gồm VAT.
                            </div>
                        </div>
                    </div>

                    <div className={styles.payment}>
                        <div>
                            <div className={styles.sectionTitle} style={{ marginTop: 0 }}>Ghi chú</div>
                            <p>{config.note1 || 'Cảm ơn Quý khách đã sử dụng dịch vụ tại ORIA SPA.'}</p>
                            <p>{config.note2 || 'Vui lòng giữ hóa đơn để thuận tiện đối chiếu khi cần hỗ trợ.'}</p>
                        </div>
                        <div className={styles.stamp}>
                            <span>Thu ngân / Người lập hóa đơn</span>
                        </div>
                    </div>

                    <div className={styles.footer}>
                        <div>
                            <strong>{config.spaName || 'ORIA SPA'}</strong><br />
                            Hotline: <span>{config.hotline || config.phone || '0900 000 000'}</span><br />
                            Địa chỉ: <span>{config.address || '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh'}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            Hóa đơn dịch vụ Spa<br />
                            Giá dịch vụ đã bao gồm VAT.
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};
