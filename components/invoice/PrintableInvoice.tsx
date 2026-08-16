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
    bookingData?: any;
}

export const PrintableInvoice = ({ config, bookingData }: PrintableInvoiceProps) => {
    // Current date/time formatted
    const now = bookingData?.createdAt ? new Date(bookingData.createdAt) : new Date();
    const formattedDate = now.toLocaleDateString('vi-VN');
    const formattedTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    // Customer
    const cName = bookingData?.customerName || 'Khách vãng lai';
    const cPhone = bookingData?.customerPhone || '';
    const cEmail = bookingData?.customerEmail || '';

    // Financial
    const bCode = bookingData?.billCode || bookingData?.id?.substring(0, 8).toUpperCase() || 'HD-MẪU';
    const method = bookingData?.paymentMethod || 'Chưa thanh toán';
    const items = bookingData?.items || [];
    
    // Calculate total from items if needed, or use bookingData.totalAmount
    const subTotal = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
    const discount = bookingData?.discountAmount || 0;
    const totalAmount = bookingData?.totalAmount || Math.max(0, subTotal - discount);

    const formatVND = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

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
                                <div>{bCode}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>Ngày</div>
                                <div>{formattedDate} · {formattedTime}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>Thanh toán</div>
                                <div>{method}</div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.sectionTitle}>Thông tin khách hàng</div>
                    <div className={styles.box}>
                        {cName && (
                            <div className={styles.row}>
                                <div className={styles.label}>Họ và tên</div>
                                <div>{cName}</div>
                            </div>
                        )}
                        {cPhone && (
                            <div className={styles.row}>
                                <div className={styles.label}>Số điện thoại</div>
                                <div>{cPhone}</div>
                            </div>
                        )}
                        {cEmail && (
                            <div className={styles.row}>
                                <div className={styles.label}>Email</div>
                                <div>{cEmail}</div>
                            </div>
                        )}
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
                            {items.length > 0 ? items.map((item: any, idx: number) => {
                                const qty = item.quantity || 1;
                                const pr = item.price || 0;
                                const t = pr * qty;
                                return (
                                    <tr key={item.id || idx}>
                                        <td>{idx + 1}</td>
                                        <td>
                                            <div className={styles.serviceName}>{item.serviceName || 'Dịch vụ'}</div>
                                            <div className={styles.serviceNote}>Giá đã bao gồm VAT</div>
                                        </td>
                                        <td>{qty}</td>
                                        <td>{formatVND(pr)}</td>
                                        <td>{formatVND(t)}</td>
                                    </tr>
                                )
                            }) : (
                                <tr>
                                    <td>1</td>
                                    <td>
                                        <div className={styles.serviceName}>Chưa có dịch vụ</div>
                                    </td>
                                    <td>0</td>
                                    <td>0 ₫</td>
                                    <td>0 ₫</td>
                                </tr>
                            )}
                        </tbody>
                    </table>

                    <div className={styles.totals}>
                        <div className={styles.totalsCard}>
                            <div className={styles.totalLine}>
                                <span>Tạm tính</span>
                                <strong>{formatVND(subTotal)}</strong>
                            </div>
                            <div className={styles.totalLine}>
                                <span>Giảm giá</span>
                                <strong>{formatVND(discount)}</strong>
                            </div>
                            <div className={`${styles.totalLine} ${styles.grand}`}>
                                <span>Tổng thanh toán</span>
                                <span>{formatVND(totalAmount)}</span>
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
