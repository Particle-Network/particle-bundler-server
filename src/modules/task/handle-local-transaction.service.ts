import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Contract, Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { RpcService } from '../rpc/services/rpc.service';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import {
    CACHE_TRANSACTION_RECEIPT_TIMEOUT,
    CACHE_USEROPHASH_TXHASH_TIMEOUT,
    IS_DEVELOPMENT,
    IS_PRODUCTION,
    keyCacheChainUserOpHashReceipt,
    keyCacheChainUserOpHashTxHash,
} from '../../common/common-types';
import { EVM_CHAIN_ID } from '../../common/chains';
import entryPointAbi from '../rpc/aa/abis/entry-point-abi';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { createTxGasData, tryParseSignedTx } from '../rpc/aa/utils';
import { ListenerService } from './listener.service';
import P2PCache from '../../common/p2p-cache';
import { TypedTransaction } from '@ethereumjs/tx';

@Injectable()
export class HandleLocalTransactionService {
    private readonly lockedLocalTransactions: Set<string> = new Set();

    public constructor(
        private readonly rpcService: RpcService,
        private readonly configService: ConfigService,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly listenerService: ListenerService,
        private readonly handlePendingTransactionService: HandlePendingTransactionService,
    ) {
        if (this.canRunCron()) {
            this.listenerService.initialize(this.handlePendingTransactionByEvent.bind(this));
        }
    }

    @Cron('* * * * * *')
    public async handleLocalTransactions() {
        if (!this.canRunCron()) {
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
            const provider = this.rpcService.getJsonRpcProvider(localTransaction.chainId);
            // local transaction should have only one txHash
            const receipt = await this.rpcService.getTransactionReceipt(provider, localTransaction.txHashes[0]);
            if (!!receipt) {
                await this.handlePendingTransactionService.handlePendingTransaction(localTransaction, receipt);
            } else {
                await this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransaction, localTransaction.txHashes[0]);
            }
        } catch (error) {
            if (!IS_PRODUCTION) {
                console.error(error);
            }

            this.larkService.sendMessage(`Failed to handle local transaction: ${localTransaction.id} | ${localTransaction._id?.toString()} | ${Helper.converErrorToString(error)}`);
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
            const provider = this.rpcService.getJsonRpcProvider(chainId);
            const entryPointContract = new Contract(entryPoint, entryPointAbi, provider);
            const userOps = userOperationDocuments.map((userOperationDocument) => userOperationDocument.origin);
            let gasLimit = (BigInt(bundleGasLimit) * 15n) / 10n;

            // TODO can we remove this?
            if ([EVM_CHAIN_ID.MANTLE_MAINNET, EVM_CHAIN_ID.MANTLE_SEPOLIA_TESTNET].includes(chainId)) {
                gasLimit *= 4n;
            }

            const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
                nonce,
                gasLimit,
                ...createTxGasData(chainId, feeData),
            });

            finalizedTx.chainId = BigInt(chainId);
            const signedTx = await signer.signTransaction(finalizedTx);

            const tx: TypedTransaction = tryParseSignedTx(signedTx);
            const txHash = `0x${Buffer.from(tx.hash()).toString('hex')}`;
            const userOpHashes = userOperationDocuments.map((userOperationDocument) => userOperationDocument.userOpHash);
            for (const userOpHash of userOpHashes) {
                P2PCache.set(keyCacheChainUserOpHashTxHash(userOpHash), txHash, CACHE_USEROPHASH_TXHASH_TIMEOUT);
            }

            const transactionObjectId = new Types.ObjectId();
            await this.userOperationService.setLocalUserOperationsAsPending(
                userOperationDocuments,
                transactionObjectId,
            );

            const localTransaction = await this.transactionService.createTransaction(transactionObjectId, chainId, signedTx, userOpHashes);

            this.listenerService.appendUserOpHashPendingTransactionMap(localTransaction);

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

        P2PCache.set(keyCacheChainUserOpHashReceipt(userOpHash), receipt, CACHE_TRANSACTION_RECEIPT_TIMEOUT);
    }

    private canRunCron() {
        if (!!process.env.DISABLE_TASK) {
            return false;
        }

        if (IS_DEVELOPMENT) {
            return true;
        }

        return this.configService.get('NODE_APP_INSTANCE') === '0';
    }
}
