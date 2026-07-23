ALTER TABLE "Staff" ADD COLUMN online_status TEXT DEFAULT 'OFFLINE';
ALTER TABLE "Staff" ADD CONSTRAINT check_online_status CHECK (online_status IN ('OFFLINE', 'ONLINE', 'AT_VENUE'));
ALTER TABLE "Staff" ADD COLUMN travel_minutes INTEGER DEFAULT 0;
ALTER TABLE "Staff" ADD COLUMN available_from TIME;
ALTER TABLE "Staff" ADD COLUMN available_until TIME;
