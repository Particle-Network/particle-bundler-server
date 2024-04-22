import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Contract, Wallet, keccak256 } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { RpcService } from '../rpc/services/rpc.service';
import { AppException } from '../../common/app-exception';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { IS_DEVELOPMENT, IS_PRODUCTION } from '../../common/common-types';
import { EVM_CHAIN_ID, SUPPORT_EIP_1559 } from '../../common/chains';
import entryPointAbi from '../rpc/aa/abis/entry-point-abi';
import { TRANSACTION_STATUS, TransactionDocument } from '../rpc/schemas/transaction.schema';
import { hexConcat } from '@ethersproject/bytes';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { HandlePendingUserOperationService } from './handle-pending-user-operation.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HandleLocalTransactionService {
    private readonly lockedLocalTransactions: Set<string> = new Set();

    public constructor(
        @InjectConnection() private readonly connection: Connection,
        private readonly rpcService: RpcService,
        private readonly configService: ConfigService,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly handlePendingTransactionService: HandlePendingTransactionService,
    ) {}

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

    private async handleLocalTransaction(localTransaction: TransactionDocument) {
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

            this.larkService.sendMessage(`Failed to handle local transaction: ${Helper.converErrorToString(error)}`);            
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
            if ([EVM_CHAIN_ID.MANTLE_MAINNET, EVM_CHAIN_ID.MANTLE_SEPOLIA_TESTNET].includes(chainId)) {
                gasLimit *= 4n;
            }

            const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
                nonce,
                gasLimit,
                ...this.createTxGasData(chainId, feeData),
            });

            finalizedTx.chainId = BigInt(chainId);
            const signedTx = await signer.signTransaction(finalizedTx);

            let localTransaction: TransactionDocument;
            await Helper.startMongoTransaction(this.connection, async (session: any) => {
                const userOpHashes = userOperationDocuments.map((userOperationDocument) => userOperationDocument.userOpHash);
                localTransaction = await this.transactionService.createTransaction(chainId, signedTx, userOpHashes, session);
                const updateInfo = await this.userOperationService.setSpecialLocalUserOperationsAsPending(
                    userOperationDocuments,
                    localTransaction,
                    session,
                );

                Helper.assertTrue(
                    updateInfo.modifiedCount === userOperationDocuments.length,
                    10001,
                    `Failed to update user operations as pending\n${JSON.stringify(updateInfo)}\n${JSON.stringify(userOpHashes)}`,
                );
            });

            // listenerService.appendUserOpHashPendingTransactionMap(localTransaction);

            // no need to await
            this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransaction, localTransaction.txHashes[0]);
        } catch (error) {
            if (error instanceof AppException) {
                throw error;
            }

            if (!IS_PRODUCTION) {
                console.error('Failed to create bundle transaction', error);
            }

            this.larkService.sendMessage(`Failed to create bundle transaction: ${Helper.converErrorToString(error)}`);
            throw error;
        }
    }

    private createTxGasData(chainId: number, feeData: any) {
        if (!SUPPORT_EIP_1559.includes(chainId)) {
            return {
                type: 0,
                gasPrice: feeData.gasPrice ?? 0,
            };
        }

        return {
            type: 2,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0,
            maxFeePerGas: feeData.maxFeePerGas ?? 0,
        };
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
