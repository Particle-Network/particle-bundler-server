import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { USER_OPERATION_STATUS, UserOperation, UserOperationDocument } from '../schemas/user-operation.schema';
import { UserOperationEvent, UserOperationEventDocument } from '../schemas/user-operation-event.schema';
import { Transaction, TransactionDocument } from '../schemas/transaction.schema';
import { Helper } from '../../../common/helper';
import { splitOriginNonce } from '../aa/utils';
import { IUserOperationEventObject } from '../../../common/common-types';
import { AppException } from '../../../common/app-exception';
import { InjectRepository } from '@nestjs/typeorm';
import { UserOperationEntity } from '../entities/user-operation.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UserOperationService {
    public constructor(
        @InjectRepository(UserOperationEntity) private readonly userOperationRepository: Repository<UserOperationEntity>,
        @InjectModel(UserOperation.name) public readonly userOperationModel: Model<UserOperationDocument>,
        @InjectModel(UserOperationEvent.name) public readonly userOperationEventModel: Model<UserOperationEventDocument>,
        @InjectModel(Transaction.name) public readonly transactionModel: Model<TransactionDocument>,
    ) {}

    public async createOrUpdateUserOperation(
        chainId: number,
        userOp: any,
        userOpHash: string,
        entryPoint: string,
        userOpDoc: UserOperationDocument,
    ): Promise<UserOperationDocument> {
        Logger.debug(`[createOrUpdateUserOperation] chainId: ${chainId} | userOpHash: ${userOpHash}`);

        const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

        const nonceValueString = BigInt(nonceValue).toString();

        if (userOpDoc) {
            // not support random nonce replaced
            Helper.assertTrue(BigInt(nonceKey) === 0n, -32607);
            Helper.assertTrue(await this.checkCanBeReplaced(userOpDoc), -32607);

            return await this.resetToLocal(userOpDoc, userOpHash, entryPoint, userOp);
        }

        const userOperation = new this.userOperationModel({
            userOpHash,
            userOpSender: userOp.sender,
            userOpNonceKey: nonceKey,
            userOpNonce: nonceValueString,
            chainId,
            entryPoint,
            origin: userOp,
            status: USER_OPERATION_STATUS.LOCAL,
        });

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

        await this.userOperationRepository.save(newUserOperation);

        try {
            return await userOperation.save();
        } catch (error) {
            if (error?.message?.includes('duplicate key')) {
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
    ): Promise<UserOperationDocument[]> {
        const userOperations: UserOperationDocument[] = [];
        for (let index = 0; index < userOps.length; index++) {
            Logger.debug(`[createOrUpdateUserOperation] chainId: ${chainId} | userOpHash: ${userOpHashes[index]}`);

            const userOp = userOps[index];
            const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

            const nonceValueString = BigInt(nonceValue).toString();
            Helper.assertTrue(nonceValueString.length <= 30, -32608); // ensure nonce is less than Decimals(128)

            const userOperation = new this.userOperationModel({
                userOpHash: userOpHashes[index],
                userOpSender: userOp.sender,
                userOpNonceKey: nonceKey,
                userOpNonce: nonceValueString,
                chainId,
                entryPoint,
                origin: userOp,
                status: index === 0 ? USER_OPERATION_STATUS.LOCAL : USER_OPERATION_STATUS.ASSOCIATED,
            });

            userOperations.push(userOperation);
        }

        userOperations[0].associatedUserOps = [];
        for (const otherUserOperation of userOperations.slice(1)) {
            userOperations[0].associatedUserOps.push(otherUserOperation.toJSON());
        }

        try {
            return await Promise.all(userOperations.map((userOperation) => userOperation.save()));
        } catch (error) {
            if (error?.message?.includes('duplicate key')) {
                throw new AppException(-32607);
            }

            throw error;
        }
    }

    private async checkCanBeReplaced(userOpDoc: UserOperationDocument) {
        if (userOpDoc.updatedAt.getTime() > Date.now() - 1000 * 120) {
            return false;
        }

        if (userOpDoc.status === USER_OPERATION_STATUS.DONE) {
            return true;
        }

        if (!userOpDoc.transactionId) {
            return true;
        }

        const transaction = await this.transactionModel.findById(userOpDoc.transactionId);
        if (!transaction) {
            return true;
        }

        if (transaction.status === USER_OPERATION_STATUS.DONE) {
            return true;
        }

        return false;
    }

    public async deleteUserOperationsByIds(ids: string[]) {
        if (ids.length === 0) {
            return;
        }

        return await this.userOperationModel.deleteMany({ _id: { $in: ids } });
    }

    public async getPendingUserOperationCount(chainId: number): Promise<number> {
        return await this.userOperationModel.countDocuments({
            status: { $in: [USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.PENDING] },
            chainId,
        });
    }

    public async deleteUserOperationByUserOpHash(userOpHash: string) {
        return await this.userOperationModel.deleteMany({ userOpHash });
    }

    public async getUserOperationByAddressNonce(
        chainId: number,
        userOpSender: string,
        userOpNonceKey: string,
        userOpNonce: string,
    ): Promise<UserOperationDocument> {
        return await this.userOperationModel.findOne({ chainId, userOpSender, userOpNonceKey, userOpNonce });
    }

    public async getUserOperationByHash(userOpHash: string): Promise<UserOperationDocument> {
        return await this.userOperationModel.findOne({ userOpHash });
    }

    // Warning: can cause user nonce is not continuous
    public async getLocalUserOperations(limit: number = 1000): Promise<UserOperationDocument[]> {
        return await this.userOperationModel.aggregate([{ $match: { status: USER_OPERATION_STATUS.LOCAL } }, { $sample: { size: limit } }]);
    }

    // Warning: can cause user nonce is not continuous
    public async getLocalUserOperations2(limit: number = 1000): Promise<UserOperationEntity[]> {
        return await this.userOperationRepository.find({
            where: { status: USER_OPERATION_STATUS.LOCAL },
            take: limit,
        });
    }

    public async setLocalUserOperationsAsPending(userOpHashes: string[], transactionId: number) {
        const start = Date.now();

        const r = await this.userOperationModel.updateMany(
            { userOpHash: { $in: userOpHashes }, status: { $in: [USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.ASSOCIATED] } },
            { $set: { status: USER_OPERATION_STATUS.PENDING, transactionId: transactionObjectId.toString() } },
            { session },
        );

        Logger.debug(`[SetLocalUserOperationsAsPending] ${transactionObjectId}, Cost: ${Date.now() - start} ms`);

        return r;
    }

    public async setPendingUserOperationsToLocal(transactionId: string, session: any) {
        return await this.userOperationModel.updateMany(
            { transactionId, status: USER_OPERATION_STATUS.PENDING },
            { $set: { status: USER_OPERATION_STATUS.LOCAL, transactionId: null } },
            { session },
        );
    }

    public async setUserOperationsAsDone(userOpHashes: string[], txHash: string, blockNumber: number, blockHash: string) {
        return await this.userOperationModel.updateMany(
            { userOpHash: { $in: userOpHashes }, status: USER_OPERATION_STATUS.PENDING },
            { $set: { status: USER_OPERATION_STATUS.DONE, txHash, blockNumber, blockHash } },
        );
    }

    public async getUserOperationEvent(userOperationHash: string): Promise<UserOperationEventDocument> {
        return await this.userOperationEventModel.findOne({ userOperationHash });
    }

    public async getLocalUserOperationsCountByChainId(chainId: number): Promise<number> {
        return await this.userOperationModel.countDocuments({ status: USER_OPERATION_STATUS.LOCAL, chainId });
    }

    public async createUserOperationEvents(userOperationEventObjects: IUserOperationEventObject[]) {
        if (userOperationEventObjects.length <= 0) {
            return;
        }

        try {
            await this.userOperationEventModel.insertMany(userOperationEventObjects, {
                ordered: false,
            });
        } catch (error) {
            // nothing
        }
    }

    public async resetToLocal(userOperationDocument: UserOperationDocument, userOpHash: string, entryPoint: string, userOp: any) {
        userOperationDocument.userOpHash = userOpHash;
        userOperationDocument.entryPoint = entryPoint;
        userOperationDocument.origin = userOp;
        userOperationDocument.status = USER_OPERATION_STATUS.LOCAL;
        userOperationDocument.createdAt = new Date();
        userOperationDocument.transactionId = undefined;
        return await userOperationDocument.save();
    }
}
