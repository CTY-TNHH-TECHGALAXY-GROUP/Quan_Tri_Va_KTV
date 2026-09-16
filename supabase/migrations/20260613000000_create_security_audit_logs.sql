-- Create SecurityAuditLogs table
CREATE TABLE IF NOT EXISTS "SecurityAuditLogs" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id text,
    employee_name text,
    event_type text NOT NULL,
    ip_address text,
    user_agent text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

-- Add index for faster querying
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type ON "SecurityAuditLogs"(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON "SecurityAuditLogs"(created_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_employee_name ON "SecurityAuditLogs"(employee_name);

-- Allow Admin full access
ALTER TABLE "SecurityAuditLogs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access SecurityAuditLogs" 
ON "SecurityAuditLogs" 
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM "Users" 
        WHERE "Users".id = auth.uid()::text
        AND "Users".role = 'ADMIN'
    )
);

-- Service Role full access (for inserts from edge functions / api routes)
CREATE POLICY "Service Role full access SecurityAuditLogs" 
ON "SecurityAuditLogs" 
FOR ALL USING (true);
