import { Injectable } from '@nestjs/common';
import { Wallet, parseEther } from 'ethers';
import { LarkService } from '../common/services/lark.service';
import { Helper } from '../../common/helper';
import { IS_DEVELOPMENT, IS_PRODUCTION } from '../../common/common-types';
import { Cron } from '@nestjs/schedule';
import { $enum } from 'ts-enum-util';
import { DISABLE_DEPOSIT_CHAINS, EVM_CHAIN_ID } from '../../common/chains';
import { getBundlerChainConfig } from '../../configs/bundler-common';
import { canRunCron } from '../rpc/aa/utils';
import { SignerService } from '../rpc/services/signer.service';
import { ChainService } from '../rpc/services/chain.service';

@Injectable()
export class FillSignerBalanceService {
    private inCheckingSignerBalance: boolean = false;

    public constructor(
        private readonly larkService: LarkService,
        private readonly signerService: SignerService,
        private readonly chainService: ChainService,
    ) {}

    @Cron('0 * * * * *')
    public async checkAndFillSignerBalance() {
        if (!canRunCron() || this.inCheckingSignerBalance || !process.env.PAYMENT_SIGNER) {
            return;
        }

        if (IS_DEVELOPMENT) {
            return;
        }

        this.inCheckingSignerBalance = true;

        let currentChainId: number;
        let currentAddress: string;

        const chains = $enum(EVM_CHAIN_ID).values();
        for (const chainId of chains) {
            currentChainId = Number(chainId);
            const bundlerConfig = getBundlerChainConfig(Number(chainId));
            if (!bundlerConfig.minSignerBalance) {
                continue;
            }
            if (DISABLE_DEPOSIT_CHAINS.includes(currentChainId)) {
                continue;
            }

            try {
                const provider = this.chainService.getJsonRpcProvider(currentChainId);

                const minSignerBalance = bundlerConfig.minSignerBalance;
                const signers = this.signerService.getChainSigners(currentChainId);
                for (const signer of signers) {
                    currentAddress = signer.address;
                    const rBalance = await this.chainService.getBalance(currentChainId, currentAddress);
                    const balance = BigInt(rBalance.result);
                    const balanceEther = Number(balance / 10n ** 9n) / 1e9;

                    console.log(`[Check signer balance] chainId=${currentChainId}, address=${currentAddress}, balance=${balanceEther}`);

                    if (balanceEther < minSignerBalance) {
                        const etherToSend = (minSignerBalance - balanceEther).toFixed(10);
                        console.log(`[Send ether to signer] chainId=${currentChainId}, address=${currentAddress}, etherToSend=${etherToSend}`);
                        const signerToPay = new Wallet(process.env.PAYMENT_SIGNER, provider);
                        const feeData: any = await this.chainService.getFeeDataIfCache(currentChainId);

                        // force use gas price
                        const tx = await signerToPay.sendTransaction({
                            type: 0,
                            to: currentAddress,
                            value: parseEther(etherToSend.toString()) + parseEther(bundlerConfig?.signerBalanceRange?.toString() ?? '0.1'),
                            gasPrice: feeData.gasPrice,
                        });

                        console.log(`[Sent Tx] ${currentChainId}, ${tx.hash}`);
                        await tx.wait();
                        const balanceAfter = await provider.getBalance(currentAddress);
                        const balanceEtherAfter = Number(balanceAfter / 10n ** 9n) / 1e9;
                        console.log('After send', currentChainId, currentAddress, balanceEtherAfter);

                        this.larkService.sendMessage(
                            `Fill Signer For ${currentAddress} On ChainId ${currentChainId}, Current Balance: ${balanceAfter}`,
                            `Fill Signer Success`,
                        );
                    } else {
                        this.signerService.UnblockedSigner(Number(chainId), currentAddress);
                    }
                }
            } catch (error) {
                if (!IS_PRODUCTION) {
                    console.error(`Error on chain ${currentChainId}`, error);
                }

                this.larkService.sendMessage(
                    `Fill Signer Failed For ${currentAddress} On ChainId ${currentChainId}\n${Helper.converErrorToString(error)}`,
                    `Fill Signer Error`,
                );
            }
        }

        this.inCheckingSignerBalance = false;
    }
}
