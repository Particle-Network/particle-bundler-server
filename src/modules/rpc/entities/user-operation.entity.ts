import { Entity, Column, Unique, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum USER_OPERATION_STATUS {
    LOCAL,
    PENDING,
    DONE,
    ASSOCIATED,
}

@Entity('user_operations')
@Unique(['userOpHash'])
@Unique(['chainId', 'userOpSender', 'userOpNonceKey', 'userOpNonce'])
@Index(['chainId', 'status', 'id'])
@Index(['status', 'id'])
export class UserOperationEntity extends BaseEntity<UserOperationEntity> {
    @Column({ name: 'chain_id', readonly: true, type: 'bigint' })
    public chainId: number;

    @Column({ name: 'entry_point', readonly: true, type: 'varchar' })
    public readonly entryPoint: string;

    @Column({ name: 'user_op_hash', readonly: true, type: 'varchar' })
    public readonly userOpHash: string;

    @Column({ name: 'user_op_sender', readonly: true, type: 'varchar' })
    public readonly userOpSender: string;

    @Column({ name: 'user_op_nonce_key', readonly: true, type: 'varchar' })
    public readonly userOpNonceKey: string;

    @Column({ name: 'user_op_nonce', readonly: true, type: 'bigint' })
    public readonly userOpNonce: number;

    @Column({ name: 'origin', readonly: true, type: 'json' })
    public readonly origin: any;

    @Column({ name: 'status', readonly: true, type: 'tinyint' })
    public readonly status: USER_OPERATION_STATUS;

    @Column({ name: 'transaction_id', readonly: true, type: 'varchar', default: '' })
    public readonly transactionId: string = '';

    @Column({ name: 'tx_hash', readonly: true, type: 'varchar', default: '' })
    public readonly txHash: string = '';

    @Column({ name: 'block_hash', readonly: true, type: 'varchar', default: '' })
    public readonly blockHash: string = '';

    @Column({ name: 'block_number', readonly: true, type: 'bigint', default: 0 })
    public readonly blockNumber: number = 0;

    @Column({ name: 'associated_user_ops', readonly: true, type: 'json' })
    public readonly associatedUserOps: any;

    public constructor(partial: Partial<UserOperationEntity>) {
        super(partial);
    }

    public resetType() {
        super.resetType();
        this.chainId = Number(this.chainId);
    }
}
