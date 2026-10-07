-- Constraints not expressible in the Prisma schema. Keep them in versioned SQL.
ALTER TABLE `game_files`
  ADD CONSTRAINT `game_files_checksum_format` CHECK (
    REGEXP_LIKE(`checksum`, '^[0-9a-f]+$', 'c') AND
    CHAR_LENGTH(`checksum`) = CASE `hash_algorithm`
      WHEN 'SHA256' THEN 64 WHEN 'SHA1' THEN 40 WHEN 'MD5' THEN 32 WHEN 'CRC32' THEN 8
    END
  );

ALTER TABLE `device_api_keys`
  ADD CONSTRAINT `device_api_keys_hash_format` CHECK (REGEXP_LIKE(`key_hash`, '^[0-9a-f]{64}$', 'c'));

ALTER TABLE `play_sessions`
  ADD CONSTRAINT `play_sessions_valid_interval` CHECK (
    (`ended_at` IS NULL AND `duration_seconds` IS NULL) OR
    (`ended_at` IS NOT NULL AND `duration_seconds` IS NOT NULL AND
      `ended_at` >= `started_at` AND
      `duration_seconds` <= TIMESTAMPDIFF(SECOND, `started_at`, `ended_at`))
  );

ALTER TABLE `save_versions`
  ADD CONSTRAINT `save_versions_positive_version` CHECK (`version` > 0),
  ADD CONSTRAINT `save_versions_checksum_format` CHECK (REGEXP_LIKE(`checksum`, '^[0-9a-f]{64}$', 'c')),
  ADD CONSTRAINT `save_versions_not_own_parent` CHECK (`parent_version_id` IS NULL OR `parent_version_id` <> `id`);

ALTER TABLE `metadata_cache`
  ADD CONSTRAINT `metadata_cache_valid_expiry` CHECK (`expires_at` >= `fetched_at`);
