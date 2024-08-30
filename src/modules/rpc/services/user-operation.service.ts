import { Injectable, Logger } from '@nestjs/common';
import { Helper } from '../../../common/helper';
import { splitOriginNonce } from '../aa/utils';
import { AppException } from '../../../common/app-exception';
import { InjectRepository } from '@nestjs/typeorm';
import { USER_OPERATION_STATUS, UserOperationEntity } from '../entities/user-operation.entity';
import { In, Repository } from 'typeorm';
import { TRANSACTION_STATUS, TransactionEntity } from '../entities/transaction.entity';
import { UserOperationEventEntity } from '../entities/user-operation-event.entity';
import { IS_DEVELOPMENT, IS_PRODUCTION } from '../../../common/common-types';
import { InjectModel } from '@nestjs/mongoose';
import { UserOperation, UserOperationDocument } from '../schemas/user-operation.schema';
import { UserOperationEvent, UserOperationEventDocument } from '../schemas/user-operation-event.schema';
import { Model } from 'mongoose';

@Injectable()
export class UserOperationService {
    public constructor(
        @InjectRepository(UserOperationEntity) private readonly userOperationRepository: Repository<UserOperationEntity>,
        @InjectRepository(UserOperationEventEntity) private readonly userOperationEventRepository: Repository<UserOperationEventEntity>,
        @InjectRepository(TransactionEntity) private readonly transactionRepository: Repository<TransactionEntity>,
        @InjectModel(UserOperation.name) public readonly userOperationModel: Model<UserOperationDocument>,
        @InjectModel(UserOperationEvent.name) public readonly userOperationEventModel: Model<UserOperationEventDocument>,
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

        // FAKE
        if (!IS_DEVELOPMENT) {
            try {
                const userOperation = new this.userOperationModel({
                    userOpHash,
                    userOpSender: userOp.sender,
                    userOpNonceKey: nonceKey,
                    userOpNonce: BigInt(nonceValue).toString(),
                    chainId,
                    entryPoint,
                    origin: userOp,
                    status: USER_OPERATION_STATUS.PENDING,
                });

                await userOperation.save();
            } catch (error) {
                // nothing
            }
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

            // FAKE
            if (!IS_DEVELOPMENT) {
                try {
                    const userOperation = new this.userOperationModel({
                        userOpHash: userOpHashes[index],
                        userOpSender: userOp.sender,
                        userOpNonceKey: nonceKey,
                        userOpNonce: BigInt(nonceValue).toString(),
                        chainId,
                        entryPoint,
                        origin: userOp,
                        status: USER_OPERATION_STATUS.PENDING,
                    });

                    await userOperation.save();
                } catch (error) {
                    // nothing
                }
            }

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

    // Warning: can cause user nonce is not continuous
    public async getLocalUserOperations(chainIds: number[], limit: number = 1000): Promise<UserOperationEntity[]> {
        return await this.userOperationRepository.find({
            where: { chainId: In(chainIds), status: USER_OPERATION_STATUS.LOCAL },
            take: limit,
        });
    }

    public async setLocalUserOperationsAsPending(userOpHashes: string[], transactionId: number) {
        const start = Date.now();

        await this.userOperationRepository
            .createQueryBuilder()
            .update(UserOperationEntity)
            .set({ status: USER_OPERATION_STATUS.PENDING, transactionId })
            .where('user_op_hash IN (:...userOpHashes) AND status IN (:...status)', {
                userOpHashes,
                status: [USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.ASSOCIATED],
            })
            .execute();

        Logger.debug(`[SetLocalUserOperationsAsPending] ${transactionId}, Cost: ${Date.now() - start} ms`);
    }

    public async setUserOperationsAsDone(userOpHashes: string[], txHash: string, blockNumber: number, blockHash: string) {
        await this.userOperationRepository
            .createQueryBuilder()
            .update(UserOperationEntity)
            .set({ status: USER_OPERATION_STATUS.DONE, txHash, blockNumber, blockHash })
            .where('user_op_hash IN (:...userOpHashes) AND status = :status', {
                userOpHashes,
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

        let userOpEventDocs: UserOperationEventDocument[] = [];
        for (const userOperationEventEntity of userOperationEventEntities) {
            const userOpEventDoc = new this.userOperationEventModel({
                chainId: userOperationEventEntity.chainId,
                blockHash: userOperationEventEntity.blockHash,
                blockNumber: userOperationEventEntity.blockNumber,
                contractAddress: userOperationEventEntity.entryPoint,
                userOperationHash: userOperationEventEntity.userOpHash,
                txHash: userOperationEventEntity.txHash,
                topic: userOperationEventEntity.topic,
                args: userOperationEventEntity.args,
            });

            userOpEventDocs.push(userOpEventDoc);
        }

        // FAKE
        try {
            await this.userOperationEventModel.insertMany(userOpEventDocs, {
                ordered: false,
            });
        } catch (error) {
            // nothing
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
