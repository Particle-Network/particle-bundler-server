import { Entity, Column, Unique, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum SOLANA_TRANSACTION_STATUS {
    LOCAL,
    PENDING,
    FAILED,
    SUCCESS,
}

@Entity('solana_transactions_20240930')
@Unique(['userOpHash'])
@Index(['status', 'id'])
export class SolanaTransactionEntity extends BaseEntity<SolanaTransactionEntity> {
    @Column({ name: 'chain_id', readonly: true, type: 'bigint' })
    public chainId: number;

    @Column({ name: 'user_op_hash', readonly: true, type: 'varchar' })
    public readonly userOpHash: string;

    @Column({ name: 'block_hash', readonly: true, type: 'varchar' })
    public readonly blockHash: string;

    @Column({ name: 'serialized_transaction', readonly: true, type: 'varchar' })
    public readonly serializedTransaction: string;

    @Column({ name: 'status', type: 'tinyint' })
    public status: SOLANA_TRANSACTION_STATUS;

    @Column({ name: 'tx_signature', type: 'varchar' })
    public txSignature: string;

    @Column({ name: 'confirmations', type: 'bigint' })
    public confirmations: number;

    @Column({ name: 'receipt', type: 'json', nullable: true })
    public receipt: any;

    @Column({ name: 'failed_reason', type: 'varchar' })
    public failedReason: string;

    @Column({ name: 'latest_sent_at', type: 'datetime' })
    public latestSentAt: Date;

    @Column({ name: 'expired_at', type: 'bigint' })
    public expiredAt: number;

    public constructor(partial: Partial<SolanaTransactionEntity>) {
        super(partial);
    }

    public resetType() {
        super.resetType();
        this.chainId = Number(this.chainId);
        this.expiredAt = Number(this.expiredAt);
    }
}
