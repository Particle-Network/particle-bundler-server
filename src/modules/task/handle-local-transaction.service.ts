import { Injectable, Logger } from '@nestjs/common';
import { Wallet } from 'ethers';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { EVM_CHAIN_ID, NEED_TO_ESTIMATE_GAS_BEFORE_SEND } from '../../common/chains';
import { TransactionService } from '../rpc/services/transaction.service';
import { UserOperationService } from '../rpc/services/user-operation.service';
import { HandlePendingTransactionService } from './handle-pending-transaction.service';
import { Cron } from '@nestjs/schedule';
import {
    canRunCron,
    createTxGasData,
    createUniqId,
    deepHexlify,
    getSupportEvmChainIdCurrentProcess,
    splitOriginNonce,
    tryParseSignedTx,
} from '../rpc/aa/utils';
import { SignerService } from '../rpc/services/signer.service';
import { ChainService } from '../rpc/services/chain.service';
import { TypedTransaction } from '@ethereumjs/tx';
import { onCreateUserOpTxHash, onEmitUserOpEvent } from '../../configs/bundler-common';
import { ListenerService } from './listener.service';
import { RpcService } from '../rpc/services/rpc.service';
import { entryPointAbis } from '../rpc/aa/abis/entry-point-abis';
import { UserOperationEntity } from '../rpc/entities/user-operation.entity';
import { TRANSACTION_STATUS, TransactionEntity } from '../rpc/entities/transaction.entity';

@Injectable()
export class HandleLocalTransactionService {
    private readonly lockedLocalTransactions: Set<number> = new Set();

    public constructor(
        private readonly rpcService: RpcService,
        private readonly chainService: ChainService,
        private readonly larkService: LarkService,
        private readonly transactionService: TransactionService,
        private readonly userOperationService: UserOperationService,
        private readonly signerService: SignerService,
        private readonly listenerService: ListenerService,
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
            const localTransactions = await this.transactionService.getTransactionsByStatus(
                getSupportEvmChainIdCurrentProcess(),
                TRANSACTION_STATUS.LOCAL,
                500,
                { signedTxs: false, inners: false },
            );
            for (const localTransaction of localTransactions) {
                this.handleLocalTransaction(localTransaction);
            }
        } catch (error) {
            Logger.error(`Handle Local Transactions Error`, error);
            this.larkService.sendMessage(`Handle Local Transactions Error: ${Helper.converErrorToString(error)}`);
        }
    }

    public async handleLocalTransaction(localTransactionEntity: TransactionEntity) {
        if (this.lockedLocalTransactions.has(localTransactionEntity.id)) {
            return;
        }

        this.lockedLocalTransactions.add(localTransactionEntity.id);

        try {
            const receipt = await this.chainService.getTransactionReceipt(
                localTransactionEntity.chainId,
                localTransactionEntity.txHashes.at(-1),
            );

            if (!!receipt) {
                await this.handlePendingTransactionService.handlePendingTransaction(localTransactionEntity, receipt);
            } else {
                const signerDoneTransactionMaxNonce =
                    this.handlePendingTransactionService.getSignerDoneTransactionMaxNonceFromCache(localTransactionEntity);

                // the pending transaction is too old, force to finish it
                if (!!signerDoneTransactionMaxNonce && signerDoneTransactionMaxNonce > localTransactionEntity.nonce) {
                    await this.handlePendingTransactionService.handlePendingTransaction(localTransactionEntity, null);
                } else {
                    await this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(
                        localTransactionEntity,
                        localTransactionEntity.txHashes.at(-1),
                    );
                }
            }
        } catch (error) {
            Logger.error(`Failed to handle local transaction: ${localTransactionEntity.id}`, error);
            this.larkService.sendMessage(
                `Failed to handle local transaction: ${localTransactionEntity.id}: ${Helper.converErrorToString(error)}`,
            );
        }

        this.lockedLocalTransactions.delete(localTransactionEntity.id);
    }

    public async createBundleTransaction(
        chainId: number,
        entryPoint: string,
        userOperationEntities: UserOperationEntity[],
        bundleGasLimit: string,
        signer: Wallet,
        nonce: number,
        feeData: any,
    ) {
        Logger.debug(`[createBundleTransaction] signer: ${signer.address} | nonce: ${nonce} | userOpDocCount: ${userOperationEntities.length}`);

        const beneficiary = signer.address;
        const entryPointVersion = this.rpcService.getVersionByEntryPoint(entryPoint);
        const entryPointContract = this.rpcService.getSetCachedContract(entryPoint, entryPointAbis[entryPointVersion]);
        const allUserOperationEntities = this.flatAllUserOperationDocuments(userOperationEntities);
        const userOps = allUserOperationEntities.map((o) => o.origin);

        // may userops contain folded userop, so we need to sort again
        userOps.sort((a, b) => {
            const { nonceKey: aNonceKey, nonceValue: aNonceValue } = splitOriginNonce(a.nonce);
            const { nonceKey: bNonceKey, nonceValue: bNonceValue } = splitOriginNonce(b.nonce);

            if (BigInt(aNonceKey) !== BigInt(bNonceKey)) {
                return BigInt(aNonceKey) > BigInt(bNonceKey) ? 1 : -1;
            }

            return BigInt(aNonceValue) > BigInt(bNonceValue) ? 1 : -1;
        });

        // HACK: Solve MEV issue: gas price value capture issue
        // HACK: Keep gas price as user op's gas price to solve MEV issue
        // UT Paymaster 0xCde0227541e6585535c8cee8fb8e1349D3254D5f, 0x472edeFE5647cA44eDF8D0068a6ce1c844F6822d
        if (
            userOps.length > 0 &&
            !userOps[0].paymasterAndData.startsWith('0xCde0227541e6585535c8cee8fb8e1349D3254D5f'.toLowerCase()) &&
            !userOps[0].paymasterAndData.startsWith('0x472edeFE5647cA44eDF8D0068a6ce1c844F6822d'.toLowerCase())
        ) {
            if (chainId === EVM_CHAIN_ID.LINEA_MAINNET || chainId === EVM_CHAIN_ID.POLYGON_MAINNET) {
                // increase 5%
                feeData.maxFeePerGas = (BigInt(userOps[0].maxFeePerGas) * 105n) / 100n;
                feeData.maxPriorityFeePerGas = (BigInt(userOps[0].maxPriorityFeePerGas) * 105n) / 100n;
                feeData.gasPrice = (BigInt(userOps[0].maxFeePerGas) * 105n) / 100n;
            }
        }

        const finalizedTx = await entryPointContract.handleOps.populateTransaction(userOps, beneficiary, {
            nonce,
            ...createTxGasData(chainId, feeData),
        });

        const gasLimit = await this.calculateGasLimitByBundleGasLimit(chainId, BigInt(bundleGasLimit), finalizedTx);
        finalizedTx.gasLimit = gasLimit;
        finalizedTx.chainId = BigInt(chainId);
        const signedTx = await signer.signTransaction(finalizedTx);
        const userOpHashes = allUserOperationEntities.map((o) => o.userOpHash);

        this.onCreateUserOpTxHash(signedTx, userOpHashes);

        const transactionId = createUniqId();
        await this.userOperationService.setLocalUserOperationsAsPending(userOpHashes, transactionId);
        const localTransactionEntity = await this.transactionService.createTransaction(transactionId, chainId, signedTx, userOpHashes);

        this.signerService.incrChainSignerPendingTxCount(chainId, signer.address);
        // there is lock, so no need to await
        this.listenerService.appendUserOpHashPendingTransactionMap(chainId, userOpHashes);
        this.handlePendingTransactionService.trySendAndUpdateTransactionStatus(localTransactionEntity, localTransactionEntity.txHashes.at(-1));
    }

    public async calculateGasLimitByBundleGasLimit(chainId: number, bundleGasLimit: bigint, handleOpsTx: any): Promise<bigint> {
        let multiplier = 15n;
        // HACK
        if (chainId === EVM_CHAIN_ID.SEI_TESTNET) {
            multiplier = 11n;
        }
        let gasLimit = (bundleGasLimit * multiplier) / 10n;
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

    public flatAllUserOperationDocuments(userOperationEntities: UserOperationEntity[]): UserOperationEntity[] {
        return userOperationEntities
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

    public handlePendingTransactionByEvent(chainId: number, event: any) {
        Logger.debug(`[Receive UserOpEvent From Ws] chainId: ${chainId} | UserOpHash: ${event[7].args[0]}`);

        const userOpEvent = {
            args: deepHexlify(event[7].args),
            txHash: event[7].log.transactionHash,
            entryPoint: event[7].log.address,
            blockNumber: event[7].log.blockNumber,
        };

        onEmitUserOpEvent(event[7].args[0], userOpEvent);
    }
}
