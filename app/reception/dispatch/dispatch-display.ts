/**
 * Helper hiển thị dùng chung cho màn điều phối (page.tsx và các component con).
 */

/**
 * Tên khách để hiện trên thẻ đơn.
 *
 * Đơn đã tách nhiều khách thì phải kèm nhãn khách, nếu không quầy nhìn hai thẻ
 * cùng tên không biết thẻ nào của ai. Tên vốn đã kết thúc bằng "Khách A" thì
 * bọc ngoặc tại chỗ thay vì thêm nhãn lần nữa.
 */
export const getDisplayCustomerName = (subOrder: any) => {
    const order = subOrder.originalOrder;
    let name = order.customerName || order.customerEmail || 'Khách Vãng Lai';
    if (subOrder.services.length < order.services.length) {
        if (name.match(/Khách [A-Z]$/i)) {
            name = name.replace(/Khách ([A-Z])$/i, '[Khách $1]');
        } else {
            name = `[Khách ${subOrder.subSuffix || 'A'}] ${name}`;
        }
    }
    return name.toUpperCase();
};
