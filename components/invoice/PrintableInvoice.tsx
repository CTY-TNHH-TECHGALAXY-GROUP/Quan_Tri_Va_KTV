import React from 'react';
import styles from './PrintableInvoice.module.css';

export interface InvoiceConfig {
    spaName: string;
    slogan: string;
    address: string;
    phone: string;
    email?: string;
    hotline: string;
    note1: string;
    note2: string;
    logoUrl?: string;
}

interface PrintableInvoiceProps {
    config: InvoiceConfig;
    bookingData?: any;
    lang?: string;
}

const DICT: Record<string, Record<string, string>> = {
    vi: {
        invoice: 'HÓA ĐƠN',
        spaInfo: 'Thông tin Spa',
        spaName: 'Tên đơn vị',
        address: 'Địa chỉ',
        phone: 'Điện thoại',
        email: 'Email',
        invoiceInfo: 'Thông tin hóa đơn',
        invoiceCode: 'Mã hóa đơn',
        date: 'Ngày',
        payment: 'Thanh toán',
        customerInfo: 'Thông tin khách hàng',
        customerName: 'Họ và tên',
        customerPhone: 'Số điện thoại',
        walkIn: 'Khách vãng lai',
        serviceDetails: 'Chi tiết dịch vụ',
        stt: 'STT',
        service: 'Dịch vụ',
        qty: 'SL',
        price: 'Đơn giá',
        amount: 'Thành tiền',
        vatNote: 'Giá đã bao gồm VAT',
        vatTotalNote: 'Giá dịch vụ và tổng thanh toán đã bao gồm VAT.',
        subtotal: 'Tạm tính',
        discount: 'Giảm giá',
        total: 'Tổng thanh toán',
        noteTitle: 'Ghi chú',
        cashier: 'Thu ngân / Người lập',
        footerInvoice: 'Hóa đơn dịch vụ Spa',
        footerVat: 'Giá dịch vụ đã bao gồm VAT.',
        paymentUnpaid: 'Chưa thanh toán',
        paymentCash: 'Tiền Mặt',
        paymentUsd: 'USD',
        paymentCard: 'CARD',
        paymentTransfer: 'TRANSFER',
        noService: 'Chưa có dịch vụ',
        duration: 'Thời gian'
    },
    en: {
        invoice: 'INVOICE',
        spaInfo: 'Spa Information',
        spaName: 'Spa Name',
        address: 'Address',
        phone: 'Phone',
        email: 'Email',
        invoiceInfo: 'Invoice Information',
        invoiceCode: 'Invoice No',
        date: 'Date',
        payment: 'Payment',
        customerInfo: 'Customer Information',
        customerName: 'Full Name',
        customerPhone: 'Phone Number',
        walkIn: 'Walk-in Guest',
        serviceDetails: 'Service Details',
        stt: 'No',
        service: 'Service',
        qty: 'Qty',
        price: 'Price',
        amount: 'Amount',
        vatNote: 'VAT included',
        vatTotalNote: 'Service price and total amount include VAT.',
        subtotal: 'Subtotal',
        discount: 'Discount',
        total: 'Total Amount',
        noteTitle: 'Note',
        cashier: 'Cashier / Prepared by',
        footerInvoice: 'Spa Service Invoice',
        footerVat: 'Prices include VAT.',
        paymentUnpaid: 'Unpaid',
        paymentCash: 'CASH',
        paymentUsd: 'USD',
        paymentCard: 'CARD',
        paymentTransfer: 'TRANSFER',
        noService: 'No service',
        duration: 'Duration'
    },
    cn: {
        invoice: '发票',
        spaInfo: '水疗中心信息',
        spaName: '单位名称',
        address: '地址',
        phone: '电话',
        email: '电子邮件',
        invoiceInfo: '发票信息',
        invoiceCode: '发票号码',
        date: '日期',
        payment: '付款方式',
        customerInfo: '客户信息',
        customerName: '姓名',
        customerPhone: '电话号码',
        walkIn: '散客',
        serviceDetails: '服务详情',
        stt: '序号',
        service: '服务',
        qty: '数量',
        price: '单价',
        amount: '金额',
        vatNote: '含增值税',
        vatTotalNote: '服务价格和总金额包含增值税。',
        subtotal: '小计',
        discount: '折扣',
        total: '总计',
        noteTitle: '备注',
        cashier: '收银员 / 制单人',
        footerInvoice: '水疗服务发票',
        footerVat: '价格包含增值税。',
        paymentUnpaid: '未付款',
        paymentCash: '现金',
        paymentUsd: '美元',
        paymentCard: '刷卡',
        paymentTransfer: '转账',
        noService: '无服务',
        duration: '时长'
    },
    jp: {
        invoice: '請求書',
        spaInfo: 'スパ情報',
        spaName: '店舗名',
        address: '住所',
        phone: '電話番号',
        email: 'メール',
        invoiceInfo: '請求書情報',
        invoiceCode: '請求書番号',
        date: '日付',
        payment: '支払い方法',
        customerInfo: 'お客様情報',
        customerName: '氏名',
        customerPhone: '電話番号',
        walkIn: '予約なしのお客様',
        serviceDetails: 'サービス詳細',
        stt: '番号',
        service: 'サービス',
        qty: '数量',
        price: '単価',
        amount: '金額',
        vatNote: '税込',
        vatTotalNote: 'サービス料金および合計金額にはVATが含まれています。',
        subtotal: '小計',
        discount: '割引',
        total: '合計金額',
        noteTitle: '備考',
        cashier: 'レジ係 / 作成者',
        footerInvoice: 'スパサービス請求書',
        footerVat: '価格は税込です。',
        paymentUnpaid: '未払い',
        paymentCash: '現金',
        paymentUsd: '米ドル',
        paymentCard: 'カード',
        paymentTransfer: '振込',
        noService: 'サービスなし',
        duration: '時間'
    },
    kr: {
        invoice: '청구서',
        spaInfo: '스파 정보',
        spaName: '업체명',
        address: '주소',
        phone: '전화번호',
        email: '이메일',
        invoiceInfo: '청구서 정보',
        invoiceCode: '청구서 번호',
        date: '날짜',
        payment: '결제 수단',
        customerInfo: '고객 정보',
        customerName: '성명',
        customerPhone: '전화번호',
        walkIn: '방문 고객',
        serviceDetails: '서비스 상세',
        stt: '번호',
        service: '서비스',
        qty: '수량',
        price: '단가',
        amount: '금액',
        vatNote: 'VAT 포함',
        vatTotalNote: '서비스 가격 및 총액에는 VAT가 포함되어 있습니다.',
        subtotal: '소계',
        discount: '할인',
        total: '총 결제 금액',
        noteTitle: '비고',
        cashier: '계산원 / 작성자',
        footerInvoice: '스파 서비스 청구서',
        footerVat: '가격은 VAT 포함입니다.',
        paymentUnpaid: '미결제',
        paymentCash: '현금',
        paymentUsd: '달러',
        paymentCard: '카드',
        paymentTransfer: '계좌이체',
        noService: '서비스 없음',
        duration: '소요 시간'
    }
};

export const PrintableInvoice = ({ config, bookingData, lang = 'vi' }: PrintableInvoiceProps) => {
    const t = DICT[lang] || DICT['vi'];
    // Current date/time formatted
    let createdStr = bookingData?.createdAt;
    if (createdStr && !createdStr.endsWith('Z') && !createdStr.includes('+')) {
        createdStr += 'Z';
    }
    const now = createdStr ? new Date(createdStr) : new Date();
    const formattedDate = now.toLocaleDateString('vi-VN');
    const formattedTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    // Customer
    const cName = bookingData?.customerName || t.walkIn;
    const cPhone = bookingData?.customerPhone || '';
    const cEmail = bookingData?.customerEmail || '';

    // Financial
    const bCode = bookingData?.billCode || bookingData?.id?.substring(0, 8).toUpperCase() || 'HD-MẪU';
    
    // Payment Method mapping
    let method = bookingData?.paymentMethod || '';
    const rawMethod = String(method).trim().toUpperCase();
    if (!method) {
        method = t.paymentUnpaid;
    } else if (rawMethod === 'CASH' || rawMethod === 'TIỀN MẶT') {
        method = t.paymentCash;
    } else if (rawMethod === 'USD') {
        method = t.paymentUsd;
    } else if (rawMethod === 'CARD' || rawMethod === 'QUẸT THẺ') {
        method = t.paymentCard;
    } else if (rawMethod === 'TRANSFER' || rawMethod === 'CHUYỂN KHOẢN') {
        method = t.paymentTransfer;
    }

    const items = bookingData?.items || [];
    
    // Calculate total from items if needed, or use bookingData.totalAmount
    const subTotal = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
    const discount = bookingData?.discountAmount || 0;
    // Luôn tính toán lại totalAmount từ items để đảm bảo hóa đơn không bao giờ bị sai lệch toán học
    const totalAmount = Math.max(0, subTotal - discount);

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
                        <h2>{t.invoice}</h2>
                    </div>
                </header>

                <section className={styles.content}>
                    <div className={styles.grid}>
                        <div className={styles.box}>
                            <h3>{t.spaInfo}</h3>
                            <div className={styles.row}>
                                <div className={styles.label}>{t.spaName}</div>
                                <div>{config.spaName || 'ORIA SPA'}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>{t.address}</div>
                                <div>{config.address || '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh'}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>{t.phone}</div>
                                <div>{config.phone || '0900 000 000'}</div>
                            </div>
                            {config.email && (
                                <div className={styles.row}>
                                    <div className={styles.label}>{t.email}</div>
                                    <div>{config.email}</div>
                                </div>
                            )}
                        </div>

                        <div className={styles.box}>
                            <h3>{t.invoiceInfo}</h3>
                            <div className={styles.row}>
                                <div className={styles.label}>{t.invoiceCode}</div>
                                <div>{bCode}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>{t.date}</div>
                                <div>{formattedDate} · {formattedTime}</div>
                            </div>
                            <div className={styles.row}>
                                <div className={styles.label}>{t.payment}</div>
                                <div>{method}</div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.sectionTitle}>{t.customerInfo}</div>
                    <div className={styles.box}>
                        {cName && (
                            <div className={styles.row}>
                                <div className={styles.label}>{t.customerName}</div>
                                <div>{cName}</div>
                            </div>
                        )}
                        {cPhone && (
                            <div className={styles.row}>
                                <div className={styles.label}>{t.customerPhone}</div>
                                <div>{cPhone}</div>
                            </div>
                        )}
                        {cEmail && (
                            <div className={styles.row}>
                                <div className={styles.label}>{t.email}</div>
                                <div>{cEmail}</div>
                            </div>
                        )}
                    </div>
                    <div className={styles.customerDivider}></div>

                    <div className={styles.sectionTitle}>{t.serviceDetails}</div>
                    <table className={styles.invoiceTable}>
                        <thead>
                            <tr>
                                <th>{t.stt}</th>
                                <th>{t.service}</th>
                                <th>{t.duration}</th>
                                <th>{t.qty}</th>
                                <th>{t.price}</th>
                                <th>{t.amount}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.length > 0 ? items.map((item: any, idx: number) => {
                                const qty = item.quantity || 1;
                                const pr = item.price || 0;
                                const total = pr * qty;
                                
                                // Get localized service name
                                let localizedName = item.serviceName || t.service;
                                if (lang === 'en' && item.serviceNameEN) localizedName = item.serviceNameEN;
                                if (lang === 'cn' && item.serviceNameCN) localizedName = item.serviceNameCN;
                                if (lang === 'jp' && item.serviceNameJP) localizedName = item.serviceNameJP;
                                if (lang === 'kr' && item.serviceNameKR) localizedName = item.serviceNameKR;
                                
                                return (
                                    <tr key={item.id || idx}>
                                        <td>{idx + 1}</td>
                                        <td>
                                            <div className={styles.serviceName}>{localizedName}</div>
                                            <div className={styles.serviceNote}>{t.vatNote}</div>
                                        </td>
                                        <td>{item.duration || 60}'</td>
                                        <td>{qty}</td>
                                        <td>{formatVND(pr)}</td>
                                        <td>{formatVND(total)}</td>
                                    </tr>
                                )
                            }) : (
                                <tr>
                                    <td>1</td>
                                    <td>
                                        <div className={styles.serviceName}>{t.noService}</div>
                                    </td>
                                    <td>-</td>
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
                                <span>{t.subtotal}</span>
                                <strong>{formatVND(subTotal)}</strong>
                            </div>
                            {discount > 0 && (
                                <div className={styles.totalLine}>
                                    <span>{t.discount}</span>
                                    <strong>{formatVND(discount)}</strong>
                                </div>
                            )}
                            <div className={`${styles.totalLine} ${styles.grand}`}>
                                <span>{t.total}</span>
                                <span>{formatVND(totalAmount)}</span>
                            </div>
                            <div className={styles.vatNote}>
                                {t.vatTotalNote}
                            </div>
                        </div>
                    </div>

                    <div className={styles.payment}>
                        <div>
                            <div className={styles.sectionTitle} style={{ marginTop: 0 }}>{t.noteTitle}</div>
                            <p>{config.note1 || 'Cảm ơn Quý khách đã sử dụng dịch vụ tại ORIA SPA.'}</p>
                            <p>{config.note2 || 'Vui lòng giữ hóa đơn để thuận tiện đối chiếu khi cần hỗ trợ.'}</p>
                        </div>
                        <div className={styles.stamp}>
                            <span>{t.cashier}</span>
                        </div>
                    </div>

                    <div className={styles.footer}>
                        <div>
                            <strong>{config.spaName || 'ORIA SPA'}</strong><br />
                            Hotline: <span>{config.hotline || config.phone || '0900 000 000'}</span><br />
                            {t.address}: <span>{config.address || '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh'}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            {t.footerInvoice}<br />
                            {t.footerVat}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};
