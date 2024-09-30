import { Entity, Column, Unique, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum USER_OPERATION_STATUS {
    LOCAL,
    PENDING,
    DONE,
    ASSOCIATED,
}

@Entity('user_operations_20240930')
@Unique(['userOpHash'])
@Unique(['chainId', 'userOpSender', 'userOpNonceKey', 'userOpNonce'])
@Index(['chainId', 'status', 'id'])
@Index(['status', 'id'])
export class UserOperationEntity extends BaseEntity<UserOperationEntity> {
    @Column({ name: 'chain_id', readonly: true, type: 'bigint' })
    public chainId: number;

    @Column({ name: 'entry_point', type: 'varchar' })
    public entryPoint: string;

    @Column({ name: 'user_op_hash', type: 'varchar' })
    public userOpHash: string;

    @Column({ name: 'user_op_sender', readonly: true, type: 'varchar' })
    public readonly userOpSender: string;

    @Column({ name: 'user_op_nonce_key', readonly: true, type: 'varchar' })
    public readonly userOpNonceKey: string;

    @Column({ name: 'user_op_nonce', readonly: true, type: 'bigint' })
    public readonly userOpNonce: number;

    @Column({ name: 'origin', type: 'json' })
    public origin: any;

    @Column({ name: 'status', type: 'tinyint' })
    public status: USER_OPERATION_STATUS;

    @Column({ name: 'transaction_id', type: 'bigint', default: 0 })
    public transactionId: number = 0;

    @Column({ name: 'tx_hash', type: 'varchar', default: '' })
    public txHash: string = '';

    @Column({ name: 'block_hash', type: 'varchar', default: '' })
    public blockHash: string = '';

    @Column({ name: 'block_number', type: 'bigint', default: 0 })
    public blockNumber: number = 0;

    @Column({ name: 'associated_user_ops', type: 'json' })
    public associatedUserOps: any;

    public constructor(partial: Partial<UserOperationEntity>) {
        super(partial);
    }

    public resetType() {
        super.resetType();
        this.chainId = Number(this.chainId);
        this.blockNumber = Number(this.blockNumber);
    }
}
