import { Entity, Column, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('user_operation_events_20240930')
@Unique(['userOpHash'])
export class UserOperationEventEntity extends BaseEntity<UserOperationEventEntity> {
    @Column({ name: 'chain_id', readonly: true, type: 'bigint' })
    public chainId: number;

    @Column({ name: 'entry_point', readonly: true, type: 'varchar' })
    public readonly entryPoint: string;

    @Column({ name: 'block_hash', readonly: true, type: 'varchar' })
    public readonly blockHash: string;

    @Column({ name: 'block_number', readonly: true, type: 'bigint' })
    public readonly blockNumber: number;

    @Column({ name: 'user_op_hash', readonly: true, type: 'varchar' })
    public readonly userOpHash: string;

    @Column({ name: 'tx_hash', readonly: true, type: 'varchar' })
    public readonly txHash: string;

    @Column({ name: 'topic', readonly: true, type: 'varchar' })
    public readonly topic: string;

    @Column({ name: 'args', readonly: true, type: 'json' })
    public readonly args: any;

    public constructor(partial: Partial<UserOperationEventEntity>) {
        super(partial);
    }

    public resetType() {
        super.resetType();
        this.chainId = Number(this.chainId);
    }
}
