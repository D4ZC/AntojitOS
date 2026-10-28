ALTER TABLE print_jobs
  ADD COLUMN precheck_id uuid REFERENCES account_prechecks(id),
  ADD COLUMN register_id uuid REFERENCES cash_registers(id);

ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_single_source_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_single_source_check CHECK (
  (CASE WHEN ticket_id IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN receipt_id IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN shift_close_id IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN precheck_id IS NULL THEN 0 ELSE 1 END) = 1
);
ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check CHECK (
  kind IN ('addition', 'cancellation', 'reprint', 'note_update', 'receipt', 'receipt_reprint', 'shift_close', 'precheck')
);
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_precheck_destination_check CHECK (
  (kind = 'precheck' AND precheck_id IS NOT NULL AND register_id IS NOT NULL)
  OR (kind <> 'precheck' AND precheck_id IS NULL AND register_id IS NULL)
);
CREATE UNIQUE INDEX print_jobs_precheck_original_idx ON print_jobs(precheck_id) WHERE kind = 'precheck';

INSERT INTO payment_methods (id, site_id, code, name, supports_change, requires_reference, display_order)
SELECT md5(sites.id::text || ':TRANSFER')::uuid, sites.id, 'TRANSFER', 'Transferencia', false, true, 3
FROM sites ON CONFLICT (site_id, code) DO NOTHING;
