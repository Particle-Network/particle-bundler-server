import { Wallet, Contract, JsonRpcProvider, keccak256 } from 'ethers';
import { Connection } from 'mongoose';
import { BLOCK_SIGNER_REASON, keyLockSendingTransaction } from '../../../common/common-types';
import { Helper } from '../../../common/helper';
import entryPointAbi from '../aa/entry-point-abi';
import { TRANSACTION_STATUS, TransactionDocument } from '../schemas/transaction.schema';
import { UserOperationDocument } from '../schemas/user-operation.schema';
import { AAService } from '../services/aa.service';
import Lock from '../../../common/global-lock';
import { handlePendingTransaction } from './handle-pending-transactions';
import { BigNumber } from '../../../common/bignumber';
import { RpcService } from '../services/rpc.service';
import { Alert } from '../../../common/alert';
import { SUPPORT_EIP_1559 } from '../../../configs/bundler-common';
import { Logger } from '@nestjs/common';

export async function createBundleTransaction(
    chainId: number,
    entryPoint: string,
    mongodbConnection: Connection,
    provider: JsonRpcProvider,
    aaService: AAService,
    userOperationDocuments: UserOperationDocument[],
    bundleGasLimit: string,
    signer: Wallet,
    nonce: number,
    feeData: any,
) {
    try {
        const beneficiary = signer.address;
        const entryPointContract = new Contract(entryPoint, entryPointAbi, provider);
        const userOps = userOperationDocuments.map((userOperationDocument) => userOperationDocument.origin);

        const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
            nonce,
            gasLimit: BigNumber.from(bundleGasLimit).mul(15).div(10).toHexString(),
            ...createTxGasData(chainId, feeData),
        });

        finalizedTx.chainId = BigInt(chainId);
        const signedTx = await signer.signTransaction(finalizedTx);

        let localTransaction: TransactionDocument;
        await Helper.startMongoTransaction(mongodbConnection, async (session: any) => {
            const userOpHashes = userOperationDocuments.map((userOperationDocument) => userOperationDocument.userOpHash);
            localTransaction = await aaService.transactionService.createTransaction(chainId, signedTx, userOpHashes, session);

            const updateInfo = await aaService.userOperationService.transactionSetSpecialLocalUserOperationsAsPending(
                userOperationDocuments,
                localTransaction.txHash,
                session,
            );

            Helper.assertTrue(updateInfo.modifiedCount === userOperationDocuments.length, 10001, 'Failed to update user operations as pending');
        });

        // no need to await
        trySendAndUpdateTransactionStatus(localTransaction, provider, aaService);
    } catch (error) {
        console.error('Failed to create bundle transaction', error);
        Alert.sendMessage(`Failed to create bundle transaction: ${Helper.converErrorToString(error)}`);

        throw error;
    }
}

export async function handleLocalTransaction(
    mongodbConnection: Connection,
    localTransaction: TransactionDocument,
    provider: JsonRpcProvider,
    rpcService: RpcService,
    aaService: AAService,
) {
    const receipt = await rpcService.getTransactionReceipt(provider, localTransaction.txHash);
    if (!!receipt) {
        await handlePendingTransaction(provider, receipt, mongodbConnection, localTransaction, aaService);

        return;
    }

    trySendAndUpdateTransactionStatus(localTransaction, provider, aaService);
}

export async function trySendAndUpdateTransactionStatus(transaction: TransactionDocument, provider: JsonRpcProvider, aaService: AAService) {
    const currentSignedTx = transaction.getCurrentSignedTx();
    const currentSignedTxHash = keccak256(currentSignedTx);
    const keyLock = keyLockSendingTransaction(transaction.chainId, currentSignedTxHash);
    if (Lock.isAcquired(keyLock)) {
        Logger.log(`trySendAndUpdateTransactionStatus already acquired; Hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`);
        return;
    }

    await Lock.acquire(keyLock);
    Logger.log(`trySendAndUpdateTransactionStatus acquire; Hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`);

    if (aaService.isBlockedSigner(transaction.chainId, transaction.from)) {
        Logger.log(
            `trySendAndUpdateTransactionStatus release isBlockedSigner ${transaction.from} On ${transaction.chainId}; Hash: ${currentSignedTxHash}, TransactionId: ${transaction.id}`,
        );
        Lock.release(keyLock);
        return;
    }

    transaction = await aaService.transactionService.getTransactionById(transaction.id);
    if (!transaction.isLocal()) {
        Logger.log(
            `trySendAndUpdateTransactionStatus release !transaction.isLocal(); Hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`,
        );
        Lock.release(keyLock);
        return;
    }

    try {
        await provider.broadcastTransaction(currentSignedTx);
    } catch (error) {
        // insufficient funds for intrinsic transaction cost
        if (error?.message?.toLowerCase()?.includes('insufficient funds')) {
            aaService.setBlockedSigner(transaction.chainId, transaction.from, BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE, {
                transactionId: transaction.id,
            });
        }

        if (error?.message?.toLowerCase()?.includes('nonce too low')) {
            // nothing to do
        }

        console.error(`SendTransaction error: ${transaction.id}`, error);
        Alert.sendMessage(`Send Transaction Error: ${Helper.converErrorToString(error)}`);

        Lock.release(keyLock);
        return;
    }

    await aaService.transactionService.updateTransactionStatus(transaction, TRANSACTION_STATUS.PENDING);

    Logger.log(`trySendAndUpdateTransactionStatus release hash: ${currentSignedTxHash} On Chain ${transaction.chainId}`);
    Lock.release(keyLock);
}

// TODO: set min fee to ensure the transaction is sent successfully
export function createTxGasData(chainId: number, feeData: any) {
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
