import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { USER_OPERATION_STATUS, UserOperation, UserOperationDocument } from '../schemas/user-operation.schema';
import { UserOperationEvent, UserOperationEventDocument } from '../schemas/user-operation-event.schema';
import { Transaction, TransactionDocument } from '../schemas/transaction.schema';
import { Helper } from '../../../common/helper';
import { splitOriginNonce } from '../aa/utils';
import { IUserOperationEventObject } from '../../../common/common-types';

@Injectable()
export class UserOperationService {
    public constructor(
        @InjectModel(UserOperation.name) private readonly userOperationModel: Model<UserOperationDocument>,
        @InjectModel(UserOperationEvent.name) private readonly userOperationEventModel: Model<UserOperationEventDocument>,
        @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    ) {}

    public async createOrUpdateUserOperation(
        chainId: number,
        userOp: any,
        userOpHash: string,
        entryPoint: string,
        userOpDoc: UserOperationDocument,
    ): Promise<UserOperationDocument> {
        const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

        const nonceValueString = BigInt(nonceValue).toString();
        Helper.assertTrue(nonceValueString.length <= 30, -32608); // ensure nonce is less than Decimals(128)

        if (userOpDoc) {
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

        return await userOperation.save();
    }

    private async checkCanBeReplaced(userOpDoc: UserOperationDocument) {
        if (userOpDoc.status === USER_OPERATION_STATUS.DONE) {
            return true;
        }

        if (userOpDoc.updatedAt.getTime() > Date.now() - 1000 * 60) {
            return false;
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
        return await this.userOperationModel.count({ status: { $in: [USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.PENDING] }, chainId });
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

    public async getLocalUserOperations(limit: number = 1000): Promise<UserOperationDocument[]> {
        return await this.userOperationModel.aggregate([{ $match: { status: USER_OPERATION_STATUS.LOCAL } }, { $sample: { size: limit } }]);
    }

    public async setLocalUserOperationsAsPending(
        userOperationDocument: UserOperationDocument[],
        transactionObjectId: Types.ObjectId,
        session?: any,
    ) {
        const ids = userOperationDocument.map((u) => u._id);

        return await this.userOperationModel.updateMany(
            { _id: { $in: ids }, status: USER_OPERATION_STATUS.LOCAL },
            { $set: { status: USER_OPERATION_STATUS.PENDING, transactionId: transactionObjectId.toString() } },
            { session },
        );
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
        return await this.userOperationModel.count({ status: USER_OPERATION_STATUS.LOCAL, chainId });
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
