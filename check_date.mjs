const dateStrFromDB = '2026-01-23T04:50:19.612';

// Cũ
const vnTimeStr_old = new Date(dateStrFromDB).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
const vnDate_old = new Date(vnTimeStr_old);
console.log("Cũ - Hour:", vnDate_old.getHours());

// Mới
const dNew = new Date(dateStrFromDB.endsWith('Z') ? dateStrFromDB : dateStrFromDB + 'Z');
const vnTimeStr_new = dNew.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
const vnDate_new = new Date(vnTimeStr_new);
console.log("Mới - Hour:", vnDate_new.getHours());
