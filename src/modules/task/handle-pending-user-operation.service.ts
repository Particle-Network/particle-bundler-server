import { Injectable, Logger } from '@nestjs/common';
import { Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { IS_PRODUCTION } from '../../common/common-types';
import { waitSeconds } from '../rpc/aa/utils';
import { TransactionService } from '../rpc/services/transaction.service';
import { HandleLocalTransactionService } from './handle-local-transaction.service';
import { ChainService } from '../rpc/services/chain.service';

@Injectable()
export class HandlePendingUserOperationService {
    public constructor(
        private readonly larkService: LarkService,
        private readonly chainService: ChainService,
        private readonly transactionService: TransactionService,
        private readonly handleLocalTransactionService: HandleLocalTransactionService,
    ) {}

    public async handleLocalUserOperationBundles(
        chainId: number,
        signer: Wallet,
        packedBundles: { entryPoint: string; userOperations: UserOperationDocument[]; gasLimit: string }[],
    ) {
        try {
            return await this.handleLocalUserOperationBundlesAction(chainId, signer, packedBundles);
        } catch (error) {
            Logger.error(`Handle Local Ops Error On Chain ${chainId}`, error);
            this.larkService.sendMessage(`Handle Local Ops Error On Chain ${chainId}: ${Helper.converErrorToString(error)}`);
        }
    }

    private async handleLocalUserOperationBundlesAction(
        chainId: number,
        signer: Wallet,
        packedBundles: { entryPoint: string; userOperations: UserOperationDocument[]; gasLimit: string }[],
    ) {
        let latestTransaction: any, latestNonce: any, feeData: any;
        try {
            [latestTransaction, latestNonce, feeData] = await Promise.all([
                this.transactionService.getLatestTransaction(chainId, signer.address),
                this.chainService.getTransactionCountIfCache(chainId, signer.address),
                this.chainService.getFeeDataIfCache(chainId),
            ]);

            if (!feeData) {
                throw new Error('Failed to get fee data');
            }
        } catch (error) {
            // should be network error, can try again
            Logger.error(`HandleLocalUserOperationBundlesAction Error On Chain ${chainId}`, error);
            this.larkService.sendMessage(
                `HandleLocalUserOperationBundlesAction Error On Chain ${chainId}; ${Helper.converErrorToString(error)}`,
            );

            // retry after 1s
            await waitSeconds(1);
            await this.handleLocalUserOperationBundlesAction(chainId, signer, packedBundles);
            return;
        }

        const localLatestNonce = (latestTransaction ? latestTransaction.nonce : -1) + 1;
        let finalizedNonce = localLatestNonce > latestNonce ? localLatestNonce : latestNonce;

        for (const bundle of packedBundles) {
            await this.handleLocalTransactionService.createBundleTransaction(
                chainId,
                bundle.entryPoint,
                bundle.userOperations,
                bundle.gasLimit,
                signer,
                finalizedNonce,
                feeData,
            );

            finalizedNonce++;
        }
    }
}
