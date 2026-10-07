-- The server action saves a running single-employee duration through this RPC.
-- Keep browser roles blocked; only the server's service key may call it.
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb)
  TO service_role;
