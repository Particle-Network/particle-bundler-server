import { Injectable, Logger } from '@nestjs/common';
import { Helper } from '../../../common/helper';
import { splitOriginNonce } from '../aa/utils';
import { AppException } from '../../../common/app-exception';
import { InjectRepository } from '@nestjs/typeorm';
import { USER_OPERATION_STATUS, UserOperationEntity } from '../entities/user-operation.entity';
import { In, Repository } from 'typeorm';
import { TRANSACTION_STATUS, TransactionEntity } from '../entities/transaction.entity';
import { UserOperationEventEntity } from '../entities/user-operation-event.entity';
import { IS_PRODUCTION } from '../../../common/common-types';

@Injectable()
export class UserOperationService {
    public constructor(
        @InjectRepository(UserOperationEntity) private readonly userOperationRepository: Repository<UserOperationEntity>,
        @InjectRepository(UserOperationEventEntity) private readonly userOperationEventRepository: Repository<UserOperationEventEntity>,
        @InjectRepository(TransactionEntity) private readonly transactionRepository: Repository<TransactionEntity>,
    ) {}

    public async createOrUpdateUserOperation(
        chainId: number,
        userOp: any,
        userOpHash: string,
        entryPoint: string,
        userOperationEntity: UserOperationEntity,
    ): Promise<UserOperationEntity> {
        Logger.debug(`[createOrUpdateUserOperation] chainId: ${chainId} | userOpHash: ${userOpHash}`);

        const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);
        Helper.assertTrue(BigInt(nonceValue) < BigInt(Number.MAX_SAFE_INTEGER), -32608);

        if (userOperationEntity) {
            // not support random nonce replaced
            Helper.assertTrue(BigInt(nonceKey) === 0n, -32607);
            Helper.assertTrue(await this.checkCanBeReplaced(userOperationEntity), -32607);

            return await this.resetToLocal(userOperationEntity, userOpHash, entryPoint, userOp);
        }

        const newUserOperation = new UserOperationEntity({
            chainId,
            entryPoint,
            userOpHash,
            userOpSender: userOp.sender,
            userOpNonceKey: BigInt(nonceKey).toString(),
            userOpNonce: Number(BigInt(nonceValue)),
            origin: userOp,
            status: USER_OPERATION_STATUS.LOCAL,
        });

        try {
            return await this.userOperationRepository.save(newUserOperation);
        } catch (error) {
            if (error?.message?.includes('Duplicate entry')) {
                throw new AppException(-32607);
            }

            throw error;
        }
    }

    public async createBatchUserOperation(
        chainId: number,
        userOps: any[],
        userOpHashes: string[],
        entryPoint: string,
    ): Promise<UserOperationEntity[]> {
        const userOperationEntities: UserOperationEntity[] = [];
        for (let index = 0; index < userOps.length; index++) {
            Logger.debug(`[createOrUpdateUserOperation] chainId: ${chainId} | userOpHash: ${userOpHashes[index]}`);

            const userOp = userOps[index];
            const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

            const userOperationEntity = new UserOperationEntity({
                chainId,
                entryPoint,
                userOpHash: userOpHashes[index],
                userOpSender: userOp.sender,
                userOpNonceKey: BigInt(nonceKey).toString(),
                userOpNonce: Number(BigInt(nonceValue)),
                origin: userOp,
                status: index === 0 ? USER_OPERATION_STATUS.LOCAL : USER_OPERATION_STATUS.ASSOCIATED,
            });

            userOperationEntities.push(userOperationEntity);
        }

        userOperationEntities[0].associatedUserOps = [];
        for (const otherUserOperation of userOperationEntities.slice(1)) {
            userOperationEntities[0].associatedUserOps.push(otherUserOperation);
        }

        try {
            return await Promise.all(userOperationEntities.map((userOperationEntity) => this.userOperationRepository.save(userOperationEntity)));
        } catch (error) {
            if (error?.message?.includes('Duplicate entry')) {
                throw new AppException(-32607);
            }

            throw error;
        }
    }

    private async checkCanBeReplaced(userOperationEntity: UserOperationEntity) {
        // TODO should conside failed status
        if (!IS_PRODUCTION && userOperationEntity.updatedAt.getTime() > Date.now() - 1000 * 120) {
            return false;
        }

        if (userOperationEntity.status === USER_OPERATION_STATUS.DONE) {
            return true;
        }

        if (!userOperationEntity.transactionId) {
            return true;
        }

        const transaction = await this.transactionRepository.findOneBy({ id: userOperationEntity.transactionId });
        if (!transaction) {
            return true;
        }

        if (transaction.status === TRANSACTION_STATUS.DONE) {
            return true;
        }

        return false;
    }

    public async deleteUserOperationsByIds(ids: number[]) {
        if (ids.length === 0) {
            return;
        }

        await this.userOperationRepository.delete({ id: In(ids) });
    }

    public async getPendingUserOperationCount(chainId: number): Promise<number> {
        return await this.userOperationRepository.count({
            where: { chainId, status: In([USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.PENDING]) },
        });
    }

    public async deleteUserOperationByUserOpHash(userOpHash: string) {
        await this.userOperationRepository.delete({ userOpHash });
    }

    public async getUserOperationByAddressNonce(
        chainId: number,
        userOpSender: string,
        userOpNonceKey: string,
        userOpNonce: number,
    ): Promise<UserOperationEntity> {
        return await this.userOperationRepository.findOneBy({ chainId, userOpSender, userOpNonceKey, userOpNonce });
    }

    public async getUserOperationByHash(userOpHash: string): Promise<UserOperationEntity> {
        return await this.userOperationRepository.findOneBy({ userOpHash });
    }

    public async getLocalUserOperations(chainIds: number[], limit: number = 1000): Promise<UserOperationEntity[]> {
        if (chainIds.length === 0) {
            return [];
        }

        return await this.userOperationRepository.find({
            where: { chainId: In(chainIds), status: USER_OPERATION_STATUS.LOCAL },
            take: limit,
            order: { id: 'ASC' },
        });
    }

    public async setLocalUserOperationsAsPending(userOpHashes: string[], transactionId: number) {
        const fromStatuses = [USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.ASSOCIATED];
        const userOperations = await this.userOperationRepository.find({
            where: { userOpHash: In(userOpHashes), status: In(fromStatuses) },
            select: ['id'],
        });

        if (userOperations.length <= 0) {
            return;
        }

        const start = Date.now();

        await this.userOperationRepository
            .createQueryBuilder()
            .update(UserOperationEntity)
            .set({ status: USER_OPERATION_STATUS.PENDING, transactionId, updatedAt: new Date() })
            .where('id IN (:...ids) AND status IN (:...status)', {
                ids: userOperations.map((userOperation) => userOperation.id),
                status: fromStatuses,
            })
            .execute();

        Logger.debug(`[SetLocalUserOperationsAsPending] ${transactionId}, Cost: ${Date.now() - start} ms`);
    }

    public async setUserOperationsAsDone(userOpHashes: string[], txHash: string, blockNumber: number, blockHash: string) {
        const userOperations = await this.userOperationRepository.find({
            where: { userOpHash: In(userOpHashes), status: USER_OPERATION_STATUS.PENDING },
            select: ['id'],
        });

        if (userOperations.length <= 0) {
            return;
        }

        await this.userOperationRepository
            .createQueryBuilder()
            .update(UserOperationEntity)
            .set({ status: USER_OPERATION_STATUS.DONE, txHash, blockNumber, blockHash, updatedAt: new Date() })
            .where('id IN (:...ids) AND status = :status', {
                ids: userOperations.map((userOperation) => userOperation.id),
                status: USER_OPERATION_STATUS.PENDING,
            })
            .execute();
    }

    public async getUserOperationEvent(userOpHash: string): Promise<UserOperationEventEntity> {
        return await this.userOperationEventRepository.findOneBy({ userOpHash });
    }

    public async getLocalUserOperationsCountByChainId(chainId: number): Promise<number> {
        return await this.userOperationRepository.count({
            where: { chainId, status: USER_OPERATION_STATUS.LOCAL },
        });
    }

    public async createUserOperationEvents(userOperationEventEntities: UserOperationEventEntity[]) {
        if (userOperationEventEntities.length <= 0) {
            return;
        }

        await this.userOperationRepository.manager
            .createQueryBuilder()
            .insert()
            .into(UserOperationEventEntity)
            .values(userOperationEventEntities)
            .orIgnore()
            .execute();
    }

    public async resetToLocal(
        userOperationEntity: UserOperationEntity,
        userOpHash: string,
        entryPoint: string,
        userOp: any,
    ): Promise<UserOperationEntity> {
        userOperationEntity.userOpHash = userOpHash;
        userOperationEntity.entryPoint = entryPoint;
        userOperationEntity.origin = userOp;
        userOperationEntity.status = USER_OPERATION_STATUS.LOCAL;
        userOperationEntity.createdAt = new Date();
        userOperationEntity.transactionId = undefined;
        return await this.userOperationRepository.save(userOperationEntity);
    }
}
