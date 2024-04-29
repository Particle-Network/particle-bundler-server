import { Injectable } from '@nestjs/common';
import { parseEther } from 'ethers';
import { RpcService } from '../rpc/services/rpc.service';
import { LarkService } from '../common/services/lark.service';
import { BLOCK_SIGNER_REASON, IS_DEVELOPMENT } from '../../common/common-types';
import { AAService } from '../rpc/services/aa.service';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { TransactionService } from '../rpc/services/transaction.service';
import { HandleLocalTransactionService } from './handle-local-transaction.service';
import { TRANSACTION_STATUS } from '../rpc/schemas/transaction.schema';

@Injectable()
export class UnblockAndReleaseSignersService {
    private inCheckingAndReleaseBlockSigners: boolean = false;

    public constructor(
        private readonly configService: ConfigService,
        private readonly larkService: LarkService,
        private readonly aaService: AAService,
        private readonly rpcService: RpcService,
        private readonly transactionService: TransactionService,
        private readonly handleLocalTransactionService: HandleLocalTransactionService,
    ) {}

    @Cron('* * * * * *')
    public async checkAndReleaseBlockSigners() {
        if (!this.canRunCron() || this.inCheckingAndReleaseBlockSigners) {
            return;
        }

        this.inCheckingAndReleaseBlockSigners = true;
        const blockedSigners = this.aaService.getAllBlockedSigners();
        if (blockedSigners.length <= 0) {
            this.inCheckingAndReleaseBlockSigners = false;
            return;
        }

        for (const blockedSigner of blockedSigners) {
            if (blockedSigner.info.reason === BLOCK_SIGNER_REASON.INSUFFICIENT_BALANCE) {
                const provider = this.rpcService.getJsonRpcProvider(blockedSigner.chainId);
                const balance = await provider.getBalance(blockedSigner.signerAddress);

                const bundlerConfig = getBundlerChainConfig(blockedSigner.chainId);
                if (!bundlerConfig) {
                    continue;
                }

                const minEtherBalance = parseEther(bundlerConfig.minSignerBalance.toString());
                if (balance >= minEtherBalance) {
                    this.aaService.UnblockedSigner(blockedSigner.chainId, blockedSigner.signerAddress);
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
