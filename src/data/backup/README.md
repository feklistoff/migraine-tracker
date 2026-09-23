# Backup format and size limit

Format version 1 contains the complete canonical `DiaryFacts` object in a JSON envelope. `schema.ts` is intentionally strict: a new persisted field must be added there and covered by the round-trip fixture before export can generate a file. Event-local zone IDs and offsets are data, not display hints. Operational metadata (`revision`, `updatedAt`, and `lastExportGeneratedAt`) may change on restore.

Files are plain-text health data. The app records only when it generated a file; a share or download cannot prove that the user saved it.

The current import/export limit is 20 MiB (`MAX_BACKUP_BYTES` in `validate.ts`). To raise it, update that constant and the user-facing size errors in `validate.ts`, `export.ts`, and `RestorePage.tsx`. Then test parsing, preview, atomic replacement, and Files export/restore on the intended iPhone with a file at the new bound. Existing version 1 files remain compatible. There are no older backup format versions to migrate yet; a future format change needs an in-memory migration before replacement.
