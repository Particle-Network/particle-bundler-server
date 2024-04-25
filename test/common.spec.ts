import { Test, TestingModule } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { RpcModule } from '../src/modules/rpc/rpc.module';
import { MongooseModule } from '@nestjs/mongoose';
import { UserOperation, UserOperationSchema } from '../src/modules/rpc/schemas/user-operation.schema';
import { mongodbConfigAsync } from '../src/configs/mongodb.config';
import { configConfig } from '../src/configs/config.config';
import { ConfigModule } from '@nestjs/config';
import { Wallet, JsonRpcProvider, resolveProperties, parseEther } from 'ethers';
import { AA_METHODS, initializeBundlerConfig, getBundlerChainConfig } from '../src/configs/bundler-common';
import { deepHexlify, getFeeDataFromParticle, splitOriginNonce } from '../src/modules/rpc/aa/utils';
import { IContractAccount } from '../src/modules/rpc/aa/interface-contract-account';
import { BigNumber } from '../src/common/bignumber';
import { ENTRY_POINT, gaslessSponsor } from './lib/common';
import { deserializeUserOpCalldata } from '../src/modules/rpc/aa/deserialize-user-op';
import { SimpleSmartAccount } from './lib/simple-smart-account';
import { EVM_CHAIN_ID } from '../src/common/chains';

let rpcController: RpcController;
let rpcService: RpcService;

describe('Common', () => {
    beforeEach(async () => {
        await initializeBundlerConfig();

        const app: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot(configConfig),
                MongooseModule.forRootAsync(mongodbConfigAsync),
                RpcModule,
                MongooseModule.forFeature([{ name: UserOperation.name, schema: UserOperationSchema }]),
            ],
        }).compile();

        rpcController = app.get<RpcController>(RpcController);
        rpcService = app.get<RpcService>(RpcService);
    }, 60000);

    it('splitOriginNonce', async () => {
        const result = splitOriginNonce('0x77cd9ea7ae31472e833221cb26e9398e0000000000000003');
        expect(result.nonceKey).toBe('0x77cd9ea7ae31472e833221cb26e9398e');
        expect(result.nonceValue).toBe('0x03');
    }, 60000);

    it('getFeeDataFromParticle', async () => {
        let feeData = await getFeeDataFromParticle(EVM_CHAIN_ID.OPTIMISM_TESTNET_SEPOLIA);
        console.log('feeData', feeData);
        expect(feeData.baseFee).toBe(1);

        feeData = await getFeeDataFromParticle(EVM_CHAIN_ID.MERLIN_CHAIN_MAINNET);
        expect(feeData.maxPriorityFeePerGas).toBe(1001);
        expect(feeData.maxFeePerGas).toBe(1001);
        expect(feeData.gasPrice).toBe(1001);
    }, 60000);
});
