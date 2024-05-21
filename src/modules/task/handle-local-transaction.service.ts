import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Contract, Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { RpcService } from '../rpc/services/rpc.service';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { IS_PRODUCTION } from '../../common/common-types';
import { PARTICLE_CHAINS, USE_PROXY_CONTRACT_TO_ESTIMATE_GAS } from '../../common/chains';
import entryPointAbi from '../rpc/aa/abis/entry-point-abi';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { Cron } from '@nestjs/schedule';
import { canRunCron, createTxGasData } from '../rpc/aa/utils';
import { ListenerService } from './listener.service';
import { SignerService } from '../rpc/services/signer.service';
import { ChainService } from '../rpc/services/chain.service';

@Injectable()
export class HandleLocalTransactionService {
    private readonly lockedLocalTransactions: Set<string> = new Set();

    public constructor(
        private readonly chainService: ChainService,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly listenerService: ListenerService,
        private readonly signerService: SignerService,
        private readonly handlePendingTransactionService: HandlePendingTransactionService,
    ) {
        if (canRunCron()) {
            this.listenerService.initialize(this.handlePendingTransactionByEvent.bind(this));
        }
    }

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
            if (!IS_PRODUCTION) {
                console.error(error);
            }

            this.larkService.sendMessage(`Handle Local Transactions Error: ${Helper.converErrorToString(error)}`);
        }
    }

    public async handleLocalTransaction(localTransaction: TransactionDocument) {
        if (this.lockedLocalTransactions.has(localTransaction.id)) {
            return;
        }

        this.lockedLocalTransactions.add(localTransaction.id);

        try {
            // local transaction should have only one txHash
            const receipt = await this.chainService.getTransactionReceipt(localTransaction.chainId, localTransaction.txHashes[0]);
            if (!!receipt) {
                await this.handlePendingTransactionService.handlePendingTransaction(localTransaction, receipt);
            } else {
                await this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransaction, localTransaction.txHashes[0]);
            }
        } catch (error) {
            if (!IS_PRODUCTION) {
                console.error(error);
            }

            this.larkService.sendMessage(
                `Failed to handle local transaction: ${localTransaction.id} | ${localTransaction._id?.toString()} | ${Helper.converErrorToString(
                    error,
                )}`,
            );
        }

        this.lockedLocalTransactions.delete(localTransaction.id);
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
        try {
            const beneficiary = signer.address;
            const entryPointContract = new Contract(entryPoint, entryPointAbi, null);
            const userOps = userOperationDocuments.map((userOperationDocument) => userOperationDocument.origin);
            let gasLimit = BigInt(bundleGasLimit);
            if (!PARTICLE_CHAINS.includes(chainId)) {
                gasLimit = (BigInt(bundleGasLimit) * 15n) / 10n;
            }

            // TODO can we remove this?
            if (USE_PROXY_CONTRACT_TO_ESTIMATE_GAS.includes(chainId)) {
                gasLimit *= 4n;
            }

            const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
                nonce,
                gasLimit,
                ...createTxGasData(chainId, feeData),
            });

            finalizedTx.chainId = BigInt(chainId);
            const signedTx = await signer.signTransaction(finalizedTx);

            const userOpHashes = userOperationDocuments.map((userOperationDocument) => userOperationDocument.userOpHash);
            const transactionObjectId = new Types.ObjectId();
            await this.userOperationService.setLocalUserOperationsAsPending(userOperationDocuments, transactionObjectId);

            // no need to await, if failed, the userops is abandoned
            const localTransaction = await this.transactionService.createTransaction(transactionObjectId, chainId, signedTx, userOpHashes);
            this.listenerService.appendUserOpHashPendingTransactionMap(localTransaction);
            this.signerService.incrChainSignerPendingTxCount(chainId, signer.address);

            // no need to await
            this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransaction, localTransaction.txHashes[0]);
        } catch (error) {
            if (!IS_PRODUCTION) {
                console.error('Failed to create bundle transaction', error);
            }

            this.larkService.sendMessage(`Failed to create bundle transaction: ${Helper.converErrorToString(error)}`);

            throw error;
        }
    }

    public handlePendingTransactionByEvent(event: any) {
        const userOpHash = event[6];
        const userOpEvent = event[7];
        const receipt = {
            transactionHash: userOpEvent.log.transactionHash,
            blockHash: userOpEvent.log.blockHash,
            blockNumber: userOpEvent.log.blockNumber,
            status: '0x01',
            logs: [userOpEvent.log],
            isEvent: true,
        };
    }
}
