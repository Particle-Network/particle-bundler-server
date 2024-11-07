CREATE TABLE `solana_transactions` (
    `id`                                        BIGINT NOT NULL AUTO_INCREMENT,
    `chain_id`                                  BIGINT NOT NULL,
    `user_op_hash`                              VARCHAR(100) NOT NULL,
    `block_hash`                                VARCHAR(100) NOT NULL,
    `serialized_transaction`                    VARCHAR(4096) NOT NULL,
    `status`                                    TINYINT NOT NULL,
    `tx_signature`                              VARCHAR(100) NOT NULL,
    `confirmations`                             BIGINT NOT NULL,
    `receipt`                                   JSON NULL,
    `latest_sent_at`                            DATETIME NOT NULL,
    `expired_at`                                BIGINT NOT NULL,
    `failed_reason`                             VARCHAR(1024) NOT NULL,
    `created_at`                                DATETIME NOT NULL,
    `updated_at`                                DATETIME NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_user_op_hash` (`user_op_hash`),
    INDEX `idx_chain_id_status_id` (`chain_id`, `status`, `id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;