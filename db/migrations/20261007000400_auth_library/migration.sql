-- AlterTable
ALTER TABLE `library_entries` ADD COLUMN `display_title` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `registration_gate` (
    `id` INTEGER NOT NULL,
    `claimed` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    INDEX `auth_sessions_user_id_idx`(`user_id`),
    INDEX `auth_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `used_at` DATETIME(3) NULL,

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_session_id_idx`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Permanent registration mutex; existing installations are already claimed.
INSERT INTO registration_gate (id, claimed) SELECT 1, EXISTS(SELECT 1 FROM users);

-- Initial console catalog; existing catalog names are retained.
INSERT IGNORE INTO consoles (id, slug, name) VALUES
('2313b6e4-e70b-4288-9391-c075f65f7e31', 'nes', 'Nintendo Entertainment System'),
('83a069f0-6711-41df-bc7f-2d1b70bba1fa', 'snes', 'Super Nintendo'),
('c433e49f-2251-42a9-bf76-2ee2f7456a5e', 'gb', 'Game Boy'),
('199b7ecf-6d76-4e2f-ac49-a516e5c04d97', 'gbc', 'Game Boy Color'),
('d0459b20-efe8-4929-82a0-63329ffb3cc8', 'gba', 'Game Boy Advance'),
('6c99ef9c-77f4-48cd-9372-f5cb99201291', 'n64', 'Nintendo 64'),
('5fed7c48-f2f7-46f4-a229-501f65fb9127', 'nds', 'Nintendo DS'),
('a09a01f9-e466-4454-a9df-023eaf33c9bd', 'gamecube', 'Nintendo GameCube'),
('5892aaf0-aecb-4e05-ba6a-42b3242bd0e7', 'wii', 'Nintendo Wii'),
('4d334ee1-94a3-4f47-85ca-ae6220933226', 'master-system', 'Sega Master System'),
('09bd3bac-1fa5-4ce1-8884-eeaf1240baec', 'mega-drive', 'Sega Mega Drive / Genesis'),
('247d60e5-879c-464e-bca1-d210c0a5d598', 'game-gear', 'Sega Game Gear'),
('5029d1f7-b988-49d9-bef1-422179c82833', 'saturn', 'Sega Saturn'),
('b20b22de-982e-4484-8122-f1639b22d8fc', 'dreamcast', 'Sega Dreamcast'),
('11df18cb-8d95-4480-aa23-a1d3dd7aeea8', 'psx', 'PlayStation'),
('8605ecd6-b200-4f49-8ca3-e5b65bd2ab7f', 'ps2', 'PlayStation 2'),
('2929a2e8-a4d4-426c-b054-a4314ca35c3e', 'psp', 'PlayStation Portable'),
('dff6ff48-dd04-4e80-9971-a82c2e79b731', 'arcade', 'Arcade');
