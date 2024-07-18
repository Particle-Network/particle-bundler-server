import { Injectable } from '@nestjs/common';
import { parseEther } from 'ethers';
import { LarkService } from '../common/services/lark.service';
import { BLOCK_SIGNER_REASON } from '../../common/common-types';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { TransactionService } from '../rpc/services/transaction.service';
import { HandleLocalTransactionService } from './handle-local-transaction.service';
import { TRANSACTION_STATUS } from '../rpc/schemas/transaction.schema';
import { SignerService } from '../rpc/services/signer.service';
import { canRunCron } from '../rpc/aa/utils';
import { ChainService } from '../rpc/services/chain.service';

@Injectable()
export class UnblockAndReleaseSignersService {
    private inCheckingAndReleaseBlockSigners: boolean = false;

    public constructor(
        private readonly larkService: LarkService,
        private readonly signerService: SignerService,
        private readonly chainService: ChainService,
        private readonly transactionService: TransactionService,
        private readonly handleLocalTransactionService: HandleLocalTransactionService,
    ) {}

    @Cron('* * * * * *')
    public async checkAndReleaseBlockSigners() {
        if (!canRunCron() || this.inCheckingAndReleaseBlockSigners) {
            return;
        }

        this.inCheckingAndReleaseBlockSigners = true;
        const blockedSigners = this.signerService.getAllBlockedSigners();
        if (blockedSigners.length <= 0) {
            this.inCheckingAndReleaseBlockSigners = false;
            return;
        }

        for (const blockedSigner of blockedSigners) {
            if (blockedSigner.info.reason === BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE) {
                const rBalance = await this.chainService.getBalance(blockedSigner.chainId, blockedSigner.signerAddress);
                const balance = BigInt(rBalance.result);

                const bundlerConfig = getBundlerChainConfig(blockedSigner.chainId);
                if (!bundlerConfig) {
                    continue;
                }

                const minEtherBalance = parseEther(bundlerConfig.minSignerBalance.toString());
                if (balance >= minEtherBalance) {
                    this.signerService.UnblockedSigner(blockedSigner.chainId, blockedSigner.signerAddress);
                    this.larkService.sendMessage(`Balance is enough, unblock signer ${blockedSigner.signerAddress}`);
                    const transaction = await this.transactionService.getTransactionById(blockedSigner.info.transactionId);
                    if (transaction.status !== TRANSACTION_STATUS.LOCAL) {
                        this.larkService.sendMessage(`Unblock signer error: transaction is not local, ${transaction.id}`);
                        continue;
                    }

                    await this.handleLocalTransactionService.handleLocalTransaction(transaction);
                }
            }
        }

        this.inCheckingAndReleaseBlockSigners = false;
    }
}
