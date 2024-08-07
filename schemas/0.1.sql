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
    `transaction_id`        VARCHAR(40) NOT NULL,
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
    `id`                    VARCHAR(36) NOT NULL,
    `chain_id`              BIGINT NOT NULL,
    `from`           VARCHAR(100) NOT NULL,
    `to`          VARCHAR(100) NOT NULL,
    `nonce`         BIGINT NOT NULL,
    `user_operation_hashes`                JSON NOT NULL,
    `signed_txs`                JSON NOT NULL,
    `inners`                JSON NOT NULL,
    `status`                TINYINT NOT NULL,


    `status`                TINYINT NOT NULL,
    `transaction_id`        VARCHAR(40) NOT NULL,
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


@Prop({ required: true, type: Schema.Types.ObjectId })
    @Prop({ required: true, type: Schema.Types.Number })
    public status: number;

    @Prop({ required: true, type: Schema.Types.Array })
    public txHashes: string[]; // save all txHashes

    @Prop({ required: true, type: Schema.Types.Number })
    public confirmations: number;

    @Prop({ required: true, type: Schema.Types.Boolean })
    public incrRetry: boolean; // can edit by console

    @Prop({ required: false, type: Schema.Types.Mixed })
    public receipts: any;

    @Prop({ required: false, type: Schema.Types.Mixed })
    public userOperationHashMapTxHash: any;

    @Prop({ required: true, type: Schema.Types.Date })
    public latestSentAt: Date;

    @Prop({ required: false, type: Schema.Types.Date })
    public createdAt: Date;

    @Prop({ required: false, type: Schema.Types.Date })
    public updatedAt: Date;