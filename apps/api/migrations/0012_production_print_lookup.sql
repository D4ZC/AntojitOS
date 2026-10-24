-- La consulta periódica de impresión incluye originales, notas y copias.
CREATE INDEX print_jobs_ticket_history_idx
  ON print_jobs (site_id, ticket_id, created_at DESC, id DESC)
  WHERE ticket_id IS NOT NULL;
