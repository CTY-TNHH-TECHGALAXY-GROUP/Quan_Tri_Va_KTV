const nodemailer = require('nodemailer');

async function testSMTP() {
  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
      user: 'info@techgalaxygroup.com',
      pass: 'FSwZfz5vLUyc'
    }
  });

  try {
    const info = await transporter.sendMail({
      from: '"Info" <info@techgalaxygroup.com>', // sender address
      replyTo: 'cskh@techgalaxygroup.com',
      to: 'info@techgalaxygroup.com', // list of receivers
      subject: 'Test Email Verification', // Subject line
      text: 'Hello world! If you receive this, your SMTP configuration is correct.', // plain text body
      html: '<b>Hello world!</b> If you receive this, your SMTP configuration is correct.' // html body
    });

    console.log('Message sent successfully!');
    console.log('Message ID: %s', info.messageId);
  } catch (error) {
    console.error('Error occurred while sending email:');
    console.error(error);
  }
}

testSMTP();
