import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';
import { UserOperationDocument } from '../rpc/schemas/user-operation.schema';
import { RpcService } from '../rpc/services/rpc.service';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { IS_PRODUCTION } from '../../common/common-types';
import { waitSeconds } from '../rpc/aa/utils';
import { AAService } from '../rpc/services/aa.service';
import { TransactionService } from '../rpc/services/transaction.service';
import { HandleLocalTransactionService } from './handle-local-transaction.service';

@Injectable()
export class HandlePendingUserOperationService {
    public constructor(
        private readonly rpcService: RpcService,
        private readonly larkService: LarkService,
        private readonly aaService: AAService,
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
            if (!IS_PRODUCTION) {
                console.error(`Handle Local Ops Error On Chain ${chainId}`, error);
            }

            this.larkService.sendMessage(`Handle Local Ops Error On Chain ${chainId}: ${Helper.converErrorToString(error)}`);
        }
    }

    private async handleLocalUserOperationBundlesAction(
        chainId: number,
        signer: Wallet,
        packedBundles: { entryPoint: string; userOperations: UserOperationDocument[]; gasLimit: string }[],
    ) {
        const provider = this.rpcService.getJsonRpcProvider(chainId);
        let latestTransaction: any, latestNonce: any, feeData: any;
        try {
            [latestTransaction, latestNonce, feeData] = await Promise.all([
                this.transactionService.getLatestTransaction(chainId, signer.address),
                this.aaService.getTransactionCountWithCache(provider, chainId, signer.address),
                this.aaService.getFeeData(chainId),
            ]);

            if (!feeData) {
                throw new Error('Failed to get fee data');
            }
        } catch (error) {
            // should be network error, can try again

            if (!IS_PRODUCTION) {
                console.error(`HandleLocalUserOperationBundlesAction Error On Chain ${chainId}`, error);
            }

            this.larkService.sendMessage(
                `HandleLocalUserOperationBundlesAction Error On Chain ${chainId}; ${Helper.converErrorToString(error)}`,
            );

            // retry after 1s
            await waitSeconds(1);
            await this.handleLocalUserOperationBundlesAction(chainId, signer, packedBundles);
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
