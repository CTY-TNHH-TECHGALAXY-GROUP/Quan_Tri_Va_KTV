-- Create StaffNotifications table for real-time KTV support requests
CREATE TABLE IF NOT EXISTS public."StaffNotifications" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "bookingId" TEXT REFERENCES public."Bookings"(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- WATER, SUPPORT, BUY_MORE, EMERGENCY, EARLY_EXIT
    message TEXT NOT NULL,
    "isRead" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public."StaffNotifications";
