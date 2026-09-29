-- Optional patient email.
--
-- Used only to prefill the recipient when the report page opens an email
-- draft in the clinician's own mail client (report.rs email_case_report).
-- Nullable: contact details are never required, are never rendered into
-- reports or PDFs, and never leave the device except inside a draft the
-- clinician reviews and sends themselves.

ALTER TABLE patients ADD COLUMN email TEXT;
