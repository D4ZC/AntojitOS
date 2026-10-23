ALTER TABLE service_accounts
  ADD COLUMN customer_name varchar(80),
  ADD COLUMN scheduled_for timestamptz,
  ADD COLUMN schedule_dispatched_at timestamptz,
  ADD COLUMN schedule_retry_after timestamptz,
  ADD COLUMN schedule_last_error text,
  ADD COLUMN scheduled_by_user_id uuid REFERENCES app_users(id),
  ADD COLUMN scheduled_on_terminal_id uuid REFERENCES terminals(id);

CREATE INDEX service_accounts_scheduled_pending_idx
  ON service_accounts (scheduled_for, id)
  WHERE status = 'open' AND scheduled_for IS NOT NULL
    AND schedule_dispatched_at IS NULL;

ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN (
    'addition', 'cancellation', 'reprint', 'note_update',
    'receipt', 'receipt_reprint', 'shift_close'
  ));
