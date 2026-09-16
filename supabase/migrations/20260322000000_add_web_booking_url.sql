-- Migration: Add web booking URL to SystemConfigs for QR code generation
-- This URL will be used to generate QR codes on dashboards for customers to scan

INSERT INTO public."SystemConfigs" (key, value)
VALUES ('web_booking_url', '"https://nganha.vercel.app/"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
