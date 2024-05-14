import { Injectable } from '@nestjs/common';
import { JsonRpcProvider, Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import {
    CACHE_GAS_FEE_TIMEOUT,
    GAS_FEE_LEVEL,
    keyCacheChainFeeData,
} from '../../../common/common-types';
import { getFeeDataFromParticle } from '../aa/utils';
import P2PCache from '../../../common/p2p-cache';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class AAService {
    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
    ) {}

    public async getFeeData(chainId: number) {
        const cacheKey = keyCacheChainFeeData(chainId);
        let feeData = P2PCache.get(cacheKey);
        if (!!feeData) {
            return feeData;
        }

        feeData = await getFeeDataFromParticle(chainId, GAS_FEE_LEVEL.MEDIUM);
        P2PCache.set(cacheKey, feeData, CACHE_GAS_FEE_TIMEOUT);

        return feeData;
    }
}
