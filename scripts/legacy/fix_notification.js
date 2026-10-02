const fs = require('fs');
const file = 'components/NotificationProvider.tsx';
let c = fs.readFileSync(file, 'utf8');

c = c.replace(/if \(ktvScreen === 'REVIEW'\) \{\s*alert\('Vui lòng đánh giá tính cách khách hàng trước khi chuyển ca!'\);\s*\} else if \(ktvScreen === 'HANDOVER'\) \{\s*window\.dispatchEvent\(new Event\('KTV_FAST_TRACK'\)\);\s*\} else \{\s*router\.push\('\/ktv\/dashboard'\);\s*\}/, "if (ktvScreen === 'REVIEW') {\r\n                                                alert('Vui lòng đánh giá tính cách khách hàng trước khi chuyển ca!');\r\n                                            } else if (ktvScreen === 'HANDOVER' || ktvScreen === 'REWARD') {\r\n                                                window.dispatchEvent(new Event('KTV_FAST_TRACK'));\r\n                                            } else {\r\n                                                router.push('/ktv/dashboard');\r\n                                            }");

fs.writeFileSync(file, c);
console.log('Done NotificationProvider');
