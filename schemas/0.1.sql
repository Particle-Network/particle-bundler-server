CREATE SCHEMA `particle_network_bundler` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

USE `particle_network_bundler`;

CREATE TABLE `user_operations` (
    `id`                    BIGINT NOT NULL AUTO_INCREMENT,
    `chain_id`              BIGINT NOT NULL,
    `entry_point`           VARCHAR(100) NOT NULL,
    `user_op_hash`          VARCHAR(100) NOT NULL,
    `user_op_sender`        VARCHAR(100) NOT NULL,
    `user_op_nonce`         BIGINT NOT NULL,
    `user_op_nonce_key`     VARCHAR(100) NOT NULL,
    `origin`                JSON NOT NULL,
    `status`                TINYINT NOT NULL,
    `transaction_id`        BIGINT NOT NULL,
    `tx_hash`               VARCHAR(100) NOT NULL,
    `block_hash`            VARCHAR(100) NOT NULL,
    `block_number`          BIGINT NOT NULL,
    `associated_user_ops`   JSON NULL,
    `created_at`            DATETIME NOT NULL,
    `updated_at`            DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_user_op_hash` (`user_op_hash`),
    UNIQUE INDEX `uniq_chain_id_user_op_sender_user_op_nonce_key_user_op_nonce` (`chain_id`, `user_op_sender`, `user_op_nonce_key`, `user_op_nonce`),
    INDEX `idx_chain_id_status_id` (`chain_id`, `status`, `id`),
    INDEX `idx_status_id` (`status`, `id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;

CREATE TABLE `transactions` (
    `id`                                        BIGINT NOT NULL,
    `chain_id`                                  BIGINT NOT NULL,
    `from`                                      VARCHAR(100) NOT NULL,
    `to`                                        VARCHAR(100) NOT NULL,
    `nonce`                                     BIGINT NOT NULL,
    `user_operation_hashes`                     JSON NOT NULL,
    `signed_txs`                                JSON NOT NULL,
    `inners`                                    JSON NOT NULL,
    `status`                                    TINYINT NOT NULL,
    `tx_hashes`                                 JSON NOT NULL,
    `confirmations`                             BIGINT NOT NULL,
    `incr_retry`                                TINYINT NOT NULL,
    `receipts`                                  JSON NOT NULL,
    `user_operation_hash_map_tx_hash`           JSON NOT NULL,
    `latest_sent_at`                            DATETIME NOT NULL,
    `created_at`                                DATETIME NOT NULL,
    `updated_at`                                DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_chain_id_from_nonce` (`chain_id`, `from`, `nonce`),
    INDEX `idx_chain_id_status_from` (`chain_id`, `status`, `from`),
    INDEX `idx_status_latest_sent_at_confirmations` (`status`, `latest_sent_at`, `confirmations`),
    INDEX `idx_status_latest_sent_at_id` (`status`, `latest_sent_at`, `id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;

CREATE TABLE `user_operation_events` (
    `id`                BIGINT NOT NULL AUTO_INCREMENT,
    `chain_id`          BIGINT NOT NULL,
    `block_hash`        VARCHAR(100) NOT NULL,
    `block_number`      BIGINT NOT NULL,
    `entry_point`       VARCHAR(100) NOT NULL,
    `user_op_hash`      VARCHAR(100) NOT NULL,
    `tx_hash`           VARCHAR(100) NOT NULL,
    `topic`             VARCHAR(100) NOT NULL,
    `args`              JSON NOT NULL,
    `created_at`        DATETIME NOT NULL,
    `updated_at`        DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_user_op_hash` (`user_op_hash`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;
