-- Trigger to insert into StaffNotifications when a new booking is created
CREATE OR REPLACE FUNCTION public.fn_notify_on_new_booking()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public."StaffNotifications" (
        "bookingId",
        "type",
        "message",
        "isRead",
        "createdAt"
    ) VALUES (
        NEW.id,
        'NEW_ORDER',
        'Có đơn hàng mới #' || NEW."billCode" || ' từ khách ' || NEW."customerName",
        false,
        now()
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_notify_on_new_booking ON public."Bookings";
CREATE TRIGGER tr_notify_on_new_booking
AFTER INSERT ON public."Bookings"
FOR EACH ROW
EXECUTE FUNCTION public.fn_notify_on_new_booking();
