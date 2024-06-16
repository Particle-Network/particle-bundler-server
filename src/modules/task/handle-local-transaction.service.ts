import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { Contract, Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { NEED_TO_ESTIMATE_GAS_BEFORE_SEND } from '../../common/chains';
import entryPointAbi from '../rpc/aa/abis/entry-point-abi';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { Cron } from '@nestjs/schedule';
import { canRunCron, createTxGasData, getDocumentId, tryParseSignedTx } from '../rpc/aa/utils';
import { SignerService } from '../rpc/services/signer.service';
import { ChainService } from '../rpc/services/chain.service';
import { TypedTransaction } from '@ethereumjs/tx';
import { onCreateUserOpTxHash } from '../../configs/bundler-common';

@Injectable()
export class HandleLocalTransactionService {
    private readonly lockedLocalTransactions: Set<string> = new Set();

    public constructor(
        private readonly chainService: ChainService,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly signerService: SignerService,
        private readonly handlePendingTransactionService: HandlePendingTransactionService,
    ) {}

    @Cron('* * * * * *')
    public async handleLocalTransactions() {
        if (!canRunCron()) {
            return;
        }

        try {
            const localTransactions = await this.transactionService.getTransactionsByStatus(TRANSACTION_STATUS.LOCAL, 500);
            for (const localTransaction of localTransactions) {
                this.handleLocalTransaction(localTransaction);
            }
        } catch (error) {
            Logger.error(`Handle Local Transactions Error`, error);
            this.larkService.sendMessage(`Handle Local Transactions Error: ${Helper.converErrorToString(error)}`);
        }
    }

    public async handleLocalTransaction(localTransaction: TransactionDocument) {
        if (this.lockedLocalTransactions.has(getDocumentId(localTransaction))) {
            return;
        }

        this.lockedLocalTransactions.add(getDocumentId(localTransaction));

        try {
            // local transaction should have only one txHash
            const receipt = await this.chainService.getTransactionReceipt(localTransaction.chainId, localTransaction.txHashes[0]);
            if (!!receipt) {
                await this.handlePendingTransactionService.handlePendingTransaction(localTransaction, receipt);
            } else {
                await this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransaction, localTransaction.txHashes[0]);
            }
        } catch (error) {
            Logger.error(`Failed to handle local transaction: ${getDocumentId(localTransaction)}`, error);
            this.larkService.sendMessage(
                `Failed to handle local transaction: ${getDocumentId(localTransaction)}: ${Helper.converErrorToString(error)}`,
            );
        }

        this.lockedLocalTransactions.delete(getDocumentId(localTransaction));
    }

    public async createBundleTransaction(
        chainId: number,
        entryPoint: string,
        userOperationDocuments: UserOperationDocument[],
        bundleGasLimit: string,
        signer: Wallet,
        nonce: number,
        feeData: any,
    ) {
        const beneficiary = signer.address;
        const entryPointContract = new Contract(entryPoint, entryPointAbi, null);
        const allUserOperationDocuments = this.flatAllUserOperationDocuments(userOperationDocuments);
        const userOps = allUserOperationDocuments.map((o) => o.origin);

        const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
            nonce,
            ...createTxGasData(chainId, feeData),
        });
        const gasLimit = await this.calculateGasLimitByBundleGasLimit(chainId, BigInt(bundleGasLimit), finalizedTx);
        finalizedTx.gasLimit = gasLimit;
        finalizedTx.chainId = BigInt(chainId);
        const signedTx = await signer.signTransaction(finalizedTx);
        const userOpHashes = allUserOperationDocuments.map((o) => o.userOpHash);

        const transactionObjectId = new Types.ObjectId();
        await this.userOperationService.setLocalUserOperationsAsPending(userOpHashes, transactionObjectId);

        this.onCreateUserOpTxHash(signedTx, userOpHashes);

        // if failed, the userops is abandoned
        const localTransaction = await this.transactionService.createTransaction(transactionObjectId, chainId, signedTx, userOpHashes);
        this.signerService.incrChainSignerPendingTxCount(chainId, signer.address);

        // there is lock, so no need to await
        this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransaction, localTransaction.txHashes[0]);
    }

    public async calculateGasLimitByBundleGasLimit(chainId: number, bundleGasLimit: bigint, handleOpsTx: any): Promise<bigint> {
        let gasLimit = (bundleGasLimit * 15n) / 10n;
        if (NEED_TO_ESTIMATE_GAS_BEFORE_SEND.includes(chainId)) {
            gasLimit *= 5n;
            if (gasLimit < 10000000n) {
                gasLimit = 10000000n;
            }

            try {
                const gas = BigInt(await this.chainService.estimateGas(chainId, handleOpsTx));
                return gas > gasLimit ? gas : gasLimit;
            } catch (error) {
                // ignore error
            }
        }

        return gasLimit;
    }

    public flatAllUserOperationDocuments(userOperationDocuments: UserOperationDocument[]): UserOperationDocument[] {
        return userOperationDocuments
            .map((userOperationDocument) => {
                let items = [userOperationDocument];
                if (!!userOperationDocument.associatedUserOps && userOperationDocument.associatedUserOps.length > 0) {
                    items = items.concat(userOperationDocument.associatedUserOps);
                }

                return items;
            })
            .flat();
    }

    private onCreateUserOpTxHash(signedTx: string, userOpHashes: string[]) {
        const tx: TypedTransaction = tryParseSignedTx(signedTx);
        const txHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;
        userOpHashes.map((userOpHash) => onCreateUserOpTxHash(userOpHash, txHash));
    }
}
