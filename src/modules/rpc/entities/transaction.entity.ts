import { Entity, Column, Unique, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import {
    PENDING_TRANSACTION_ABANDON_TIME,
    PENDING_TRANSACTION_EXPIRED_TIME,
    PENDING_TRANSACTION_WAITING_TIME,
} from '../../../common/common-types';

export enum TRANSACTION_STATUS {
    LOCAL,
    PENDING,
    DONE,
}

@Entity('transactions')
@Unique(['chainId', 'from', 'nonce'])
@Index(['chainId', 'status', 'from'])
@Index(['status', 'latestSentAt', 'confirmations'])
@Index(['status', 'latestSentAt', 'id'])
export class TransactionEntity extends BaseEntity<TransactionEntity> {
    @Column({ name: 'chain_id', readonly: true, type: 'bigint' })
    public chainId: number;

    @Column({ name: 'from', readonly: true, type: 'varchar' })
    public readonly from: string;

    @Column({ name: 'to', readonly: true, type: 'varchar' })
    public readonly to: string;

    @Column({ name: 'nonce', type: 'bigint' })
    public nonce: number;

    @Column({ name: 'user_operation_hashes', readonly: true, type: 'json' })
    public readonly userOperationHashes: any;

    @Column({ name: 'signed_txs', readonly: true, type: 'json' })
    public readonly signedTxs: any;

    @Column({ name: 'inners', readonly: true, type: 'json' })
    public readonly inners: any;

    @Column({ name: 'status', type: 'tinyint' })
    public status: TRANSACTION_STATUS;

    @Column({ name: 'tx_hashes', readonly: true, type: 'json' })
    public readonly txHashes: any;

    @Column({ name: 'confirmations', readonly: true, type: 'bigint' })
    public readonly confirmations: number;

    @Column({ name: 'incr_retry', readonly: true, type: 'tinyint' })
    public readonly incrRetry: number;

    @Column({ name: 'receipts', type: 'json' })
    public receipts: any;

    @Column({ name: 'user_operation_hash_map_tx_hash', type: 'json' })
    public userOperationHashMapTxHash: any;

    @Column({ name: 'latest_sent_at', readonly: true, type: 'datetime' })
    public readonly latestSentAt: Date;

    public constructor(partial: Partial<TransactionEntity>) {
        super(partial);
    }

    public resetType() {
        super.resetType();
        this.chainId = Number(this.chainId);
        this.nonce = Number(this.nonce);
    }

    public isPendingTimeout(): boolean {
        return (
            [TRANSACTION_STATUS.PENDING].includes(this.status) &&
            Date.now() - new Date(this.latestSentAt).valueOf() > PENDING_TRANSACTION_WAITING_TIME * 1000
        );
    }

    public isOld(): boolean {
        return (
            [TRANSACTION_STATUS.PENDING].includes(this.status) &&
            Date.now() - new Date(this.latestSentAt).valueOf() > PENDING_TRANSACTION_EXPIRED_TIME * 1000
        );
    }

    public isTooOld(): boolean {
        return (
            [TRANSACTION_STATUS.PENDING].includes(this.status) &&
            Date.now() - new Date(this.createdAt).valueOf() > PENDING_TRANSACTION_ABANDON_TIME * 1000
        );
    }
}
