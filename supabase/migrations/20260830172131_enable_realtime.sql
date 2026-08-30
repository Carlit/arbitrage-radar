DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'market_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE market_alerts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'tenant_alert_access'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tenant_alert_access;
  END IF;
END
$$;
