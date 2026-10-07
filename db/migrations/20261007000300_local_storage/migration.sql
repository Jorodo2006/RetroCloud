-- Preserve stored identifiers and rows; historical migrations remain unchanged.
ALTER TABLE `save_versions` RENAME COLUMN `blob_key` TO `storage_key`;
ALTER TABLE `save_versions` RENAME INDEX `save_versions_blob_key_key` TO `save_versions_storage_key_key`;
