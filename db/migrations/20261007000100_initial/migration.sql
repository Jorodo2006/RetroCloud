-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `last_seen_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `devices_id_user_id_key`(`id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_api_keys` (
    `id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `key_prefix` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `device_api_keys_key_hash_key`(`key_hash`),
    INDEX `device_api_keys_device_id_idx`(`device_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consoles` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `retro_achievements_id` INTEGER UNSIGNED NULL,

    UNIQUE INDEX `consoles_slug_key`(`slug`),
    UNIQUE INDEX `consoles_retro_achievements_id_key`(`retro_achievements_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `games` (
    `id` CHAR(36) NOT NULL,
    `console_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `metadata` JSON NULL,
    `cover_url` VARCHAR(2048) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `games_console_id_title_idx`(`console_id`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_files` (
    `id` CHAR(36) NOT NULL,
    `game_id` CHAR(36) NOT NULL,
    `hash_algorithm` ENUM('SHA256', 'MD5', 'SHA1', 'CRC32') NOT NULL,
    `checksum` VARCHAR(64) NOT NULL,
    `size_bytes` BIGINT UNSIGNED NOT NULL,
    `revision` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `game_files_game_id_idx`(`game_id`),
    UNIQUE INDEX `game_files_hash_algorithm_checksum_size_bytes_key`(`hash_algorithm`, `checksum`, `size_bytes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_entries` (
    `id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `game_file_id` CHAR(36) NOT NULL,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `removed_at` DATETIME(3) NULL,

    INDEX `library_entries_game_file_id_idx`(`game_file_id`),
    UNIQUE INDEX `library_entries_device_id_game_file_id_key`(`device_id`, `game_file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `play_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `game_id` CHAR(36) NOT NULL,
    `client_session_id` CHAR(36) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `play_sessions_user_id_started_at_idx`(`user_id`, `started_at`),
    INDEX `play_sessions_game_id_started_at_idx`(`game_id`, `started_at`),
    UNIQUE INDEX `play_sessions_device_id_client_session_id_key`(`device_id`, `client_session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `save_files` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `game_id` CHAR(36) NOT NULL,
    `kind` ENUM('SRAM', 'SAVE_STATE', 'MEMORY_CARD', 'OTHER') NOT NULL,
    `slot` VARCHAR(100) NOT NULL DEFAULT 'default',
    `format_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `save_files_game_id_idx`(`game_id`),
    UNIQUE INDEX `save_files_user_id_game_id_kind_slot_format_key_key`(`user_id`, `game_id`, `kind`, `slot`, `format_key`),
    UNIQUE INDEX `save_files_id_user_id_key`(`id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `save_versions` (
    `id` CHAR(36) NOT NULL,
    `save_file_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `client_operation_id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `parent_version_id` CHAR(36) NULL,
    `blob_key` VARCHAR(512) NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `size_bytes` BIGINT UNSIGNED NOT NULL,
    `captured_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `save_versions_blob_key_key`(`blob_key`),
    INDEX `save_versions_save_file_id_user_id_idx`(`save_file_id`, `user_id`),
    INDEX `save_versions_device_id_user_id_idx`(`device_id`, `user_id`),
    UNIQUE INDEX `save_versions_save_file_id_version_key`(`save_file_id`, `version`),
    UNIQUE INDEX `save_versions_device_id_client_operation_id_key`(`device_id`, `client_operation_id`),
    UNIQUE INDEX `save_versions_id_save_file_id_key`(`id`, `save_file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `game_external_ids` (
    `id` CHAR(36) NOT NULL,
    `game_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,

    INDEX `game_external_ids_game_id_provider_idx`(`game_id`, `provider`),
    UNIQUE INDEX `game_external_ids_provider_external_id_key`(`provider`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `metadata_cache` (
    `id` CHAR(36) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `cache_key` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `metadata_cache_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `metadata_cache_provider_cache_key_key`(`provider`, `cache_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `achievement_accounts` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `linked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_synced_at` DATETIME(3) NULL,

    UNIQUE INDEX `achievement_accounts_user_id_provider_key`(`user_id`, `provider`),
    UNIQUE INDEX `achievement_accounts_provider_username_key`(`provider`, `username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `achievements` (
    `id` CHAR(36) NOT NULL,
    `game_external_id` CHAR(36) NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `points` INTEGER UNSIGNED NOT NULL,
    `badge_url` VARCHAR(2048) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `achievements_game_external_id_external_id_key`(`game_external_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_achievements` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `achievement_id` CHAR(36) NOT NULL,
    `mode` ENUM('SOFTCORE', 'HARDCORE') NOT NULL,
    `unlocked_at` DATETIME(3) NOT NULL,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_achievements_achievement_id_idx`(`achievement_id`),
    UNIQUE INDEX `user_achievements_user_id_achievement_id_mode_key`(`user_id`, `achievement_id`, `mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_api_keys` ADD CONSTRAINT `device_api_keys_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `games` ADD CONSTRAINT `games_console_id_fkey` FOREIGN KEY (`console_id`) REFERENCES `consoles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `game_files` ADD CONSTRAINT `game_files_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_entries` ADD CONSTRAINT `library_entries_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_entries` ADD CONSTRAINT `library_entries_game_file_id_fkey` FOREIGN KEY (`game_file_id`) REFERENCES `game_files`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `play_sessions` ADD CONSTRAINT `play_sessions_device_id_user_id_fkey` FOREIGN KEY (`device_id`, `user_id`) REFERENCES `devices`(`id`, `user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `play_sessions` ADD CONSTRAINT `play_sessions_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `save_files` ADD CONSTRAINT `save_files_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `save_files` ADD CONSTRAINT `save_files_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `save_versions` ADD CONSTRAINT `save_versions_save_file_id_user_id_fkey` FOREIGN KEY (`save_file_id`, `user_id`) REFERENCES `save_files`(`id`, `user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `save_versions` ADD CONSTRAINT `save_versions_device_id_user_id_fkey` FOREIGN KEY (`device_id`, `user_id`) REFERENCES `devices`(`id`, `user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `save_versions` ADD CONSTRAINT `save_versions_parent_version_id_save_file_id_fkey` FOREIGN KEY (`parent_version_id`, `save_file_id`) REFERENCES `save_versions`(`id`, `save_file_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `game_external_ids` ADD CONSTRAINT `game_external_ids_game_id_fkey` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievement_accounts` ADD CONSTRAINT `achievement_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `achievements` ADD CONSTRAINT `achievements_game_external_id_fkey` FOREIGN KEY (`game_external_id`) REFERENCES `game_external_ids`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_achievement_id_fkey` FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
