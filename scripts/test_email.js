const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
        user: 'info@techgalaxygroup.com',
        pass: 'FSwZfz5vLUyc'
    }
});

async function main() {
    try {
        const info = await transporter.sendMail({
            from: '"Info Ngan Ha - Techgalaxygroup" <info@techgalaxygroup.com>',
            to: 'huynhngoctuanhieu2000@gmail.com',
            replyTo: 'cskh@techgalaxygroup.com',
            subject: 'Test Email - Kiem tra tinh nang Reply-To cskh',
            html: `
                <h3>Xin chào Tuấn Hiếu (Test)</h3>
                <p>Đây là email test để kiểm tra xem tính năng Trả Lời (Reply-To) về mail CSKH đã hoạt động chưa.</p>
                <p>Bạn hãy bấm nút <b>Trả Lời (Reply)</b> trong Gmail. Nếu ô người nhận tự động hiện ra <b>cskh@techgalaxygroup.com</b> và bạn gửi thành công, nghĩa là hệ thống Zoho đã được cấu hình chuẩn!</p>
                <br/>
                <p>Trân trọng,<br/>Info Ngan Ha</p>
            `
        });
        console.log('Email sent successfully: ', info.messageId);
    } catch (err) {
        console.error('Lỗi khi gửi email:', err);
    }
}

main();
