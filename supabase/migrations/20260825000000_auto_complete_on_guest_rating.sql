-- Trigger on BookingGuests to auto-complete BookingItems when rating is submitted
CREATE OR REPLACE FUNCTION fn_auto_complete_on_guest_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.rating IS NOT NULL AND (OLD.rating IS NULL OR OLD.rating = 0) THEN
        UPDATE "BookingItems"
        SET status = 'DONE'
        WHERE guest_id = NEW.id 
          AND status IN ('FEEDBACK', 'CLEANING');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_auto_complete_on_guest_rating ON "BookingGuests";
CREATE TRIGGER tr_auto_complete_on_guest_rating
AFTER UPDATE OF rating ON "BookingGuests"
FOR EACH ROW
EXECUTE FUNCTION fn_auto_complete_on_guest_rating();

-- Also for backward compatibility on Bookings table (if guest rates the whole booking)
CREATE OR REPLACE FUNCTION fn_auto_complete_on_booking_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.rating IS NOT NULL AND (OLD.rating IS NULL OR OLD.rating = 0) THEN
        UPDATE "BookingItems"
        SET status = 'DONE'
        WHERE "bookingId" = NEW.id 
          AND status IN ('FEEDBACK', 'CLEANING');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_auto_complete_on_booking_rating ON "Bookings";
CREATE TRIGGER tr_auto_complete_on_booking_rating
AFTER UPDATE OF rating ON "Bookings"
FOR EACH ROW
EXECUTE FUNCTION fn_auto_complete_on_booking_rating();
