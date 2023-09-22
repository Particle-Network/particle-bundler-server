import { Test, TestingModule } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { RpcModule } from '../src/modules/rpc/rpc.module';
import { MongooseModule } from '@nestjs/mongoose';
import { UserOperation, UserOperationSchema } from '../src/modules/rpc/schemas/user-operation.schema';
import { mongodbConfigAsync } from '../src/configs/mongodb.config';
import { configConfig } from '../src/configs/config.config';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { redisConfigAsync } from '../src/configs/redis.config';
import { Contract, Wallet, JsonRpcProvider, resolveProperties, MaxUint256, toBeHex, parseEther } from 'ethers';
import { RPC_CONFIG } from '../src/configs/bundler-config';
import { AA_METHODS, EVM_CHAIN_ID, EVM_CHAIN_ID_NOT_SUPPORT_1559 } from '../src/configs/bundler-config';
import { SimpleAccount } from '../src/modules/rpc/aa/simple-account';
import { deepHexlify } from '../src/modules/rpc/aa/utils';
import { BiconomySmartAccount } from '../src/modules/rpc/aa/biconomy-smart-account';
import { IContractAccount } from '../src/modules/rpc/aa/interface-contract-account';
import { BigNumber } from '../src/common/bignumber';
import { ENTRY_POINT, gaslessSponsor } from './lib/common';

let rpcController: RpcController;
let rpcService: RpcService;

describe('RpcController', () => {
    beforeEach(async () => {
        const app: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot(configConfig),
                MongooseModule.forRootAsync(mongodbConfigAsync),
                RpcModule,
                MongooseModule.forFeature([{ name: UserOperation.name, schema: UserOperationSchema }]),
                RedisModule.forRootAsync(redisConfigAsync),
            ],
        }).compile();

        rpcController = app.get<RpcController>(RpcController);
        rpcService = app.get<RpcService>(RpcService);
    }, 60000);

    describe('basic', () => {
        it('Gasless Basic', async () => {
            const chainId = EVM_CHAIN_ID.SEPOLIA_TESTNET;

            const simpleAccount = await createSimpleAccount(chainId);
            let userOp = await createFakeUserOp(chainId, simpleAccount);

            console.log('unsignedUserOp', deepHexlify(userOp));

            userOp = await gaslessSponsor(chainId, userOp, rpcController);
            console.log('sponsoredOp', deepHexlify(userOp));

            userOp = await estimateGas(chainId, userOp);
            userOp.signature = await getSignature(simpleAccount, userOp);
            console.log('signedOp', deepHexlify(userOp));

            await sendUserOp(chainId, userOp);
        }, 60000);
    });
});

async function createSimpleAccount(chainId: number): Promise<IContractAccount> {
    const rpcUrl = RPC_CONFIG[Number(chainId)].rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl);

    const owner: Wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    const factoryAddress = '0x9406cc6185a346906296840746125a0e44976454';

    return new SimpleAccount(owner, factoryAddress, ENTRY_POINT);
}

async function createBiconomySmartAccount(chainId: number): Promise<IContractAccount> {
    const rpcUrl = RPC_CONFIG[Number(chainId)].rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl);

    const owner: Wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    const smartAccountFactoryAddress = '0x000000F9eE1842Bb72F6BBDD75E6D3d4e3e9594C';

    return new BiconomySmartAccount(owner, smartAccountFactoryAddress, ENTRY_POINT);
}

async function createFakeUserOp(chainId: number, simpleAccount: IContractAccount) {
    const feeData = await rpcService.getFeeData(chainId);
    let maxFeePerGas = feeData.maxFeePerGas;
    let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    let gasPrice = feeData.gasPrice;
    if (EVM_CHAIN_ID_NOT_SUPPORT_1559.includes(chainId)) {
        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = gasPrice;
    }

    const unsignedUserOp = await simpleAccount.createUnsignedUserOp({
        to: Wallet.createRandom().address,
        value: BigNumber.from(parseEther('0')).toHexString(),
        data: '0x',
        maxFeePerGas,
        maxPriorityFeePerGas,
    });
    return deepHexlify(await resolveProperties(unsignedUserOp));
}

async function createApproveUserOp(chainId: number, accountApi: IContractAccount, usdtAddress: string, paymasterAddress: string) {
    const rpcUrl = RPC_CONFIG[Number(chainId)].rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl);

    const usdtABI = ['function approve(address spender, uint256 amount) external returns (bool)'];
    const usdtContract = new Contract(usdtAddress, usdtABI, provider);

    const dest = await usdtContract.getAddress();
    const data: any = (await usdtContract.approve.populateTransaction(paymasterAddress, toBeHex(MaxUint256))).data;
    console.log('approve data', usdtAddress, paymasterAddress, data, await accountApi.encodeExecute(dest, 0, data));

    const unsignedUserOp: any = await accountApi.createUnsignedUserOp({
        to: dest,
        data,
    });

    return deepHexlify(await resolveProperties(unsignedUserOp));
}

async function getSignature(accountApi: IContractAccount, userOp: any) {
    const userOpHash = await accountApi.getUserOpHash(userOp);
    console.log('userOpHash', userOpHash);

    const signature = await accountApi.signUserOpHash(userOpHash);
    console.log('signature', signature);

    return signature;
}

async function estimateGas(chainId: number, userOp: any) {
    delete userOp.callGasLimit;
    delete userOp.verificationGasLimit;
    delete userOp.preVerificationGas;

    const bodyEstimate = {
        method: AA_METHODS.ESTIMATE_USER_OPERATION_GAS,
        params: [userOp, ENTRY_POINT],
    };

    const rEstimate = await rpcController.handleRpc(chainId, bodyEstimate);
    console.log('rEstimate', rEstimate);
    expect(rEstimate.result.maxFeePerGas).toBe(userOp.maxFeePerGas);
    expect(rEstimate.result.maxPriorityFeePerGas).toBe(userOp.maxPriorityFeePerGas);

    userOp.preVerificationGas = rEstimate.result.preVerificationGas;
    userOp.verificationGasLimit = rEstimate.result.verificationGasLimit;
    userOp.callGasLimit = rEstimate.result.callGasLimit;

    return deepHexlify(userOp);
}

async function sendUserOp(chainId: number, userOp: any) {
    const bodySend = {
        method: AA_METHODS.SEND_USER_OPERATION,
        params: [userOp, ENTRY_POINT],
    };

    const r3 = await rpcController.handleRpc(chainId, bodySend);
    console.log(r3);
    expect(r3.result.length).toBe(66);

    for (let index = 0; index < 10; index++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const bodyReceipt = {
            method: AA_METHODS.GET_USER_OPERATION_RECEIPT,
            params: [r3.result],
        };

        let r4 = await rpcController.handleRpc(chainId, bodyReceipt);
        console.log(r4);

        if (!!r4.result) {
            break;
        }
    }

    const bodyUserOp = {
        method: AA_METHODS.GET_USER_OPERATION_BY_HASH,
        params: [r3.result],
    };

    const r5 = await rpcController.handleRpc(chainId, bodyUserOp);
    console.log(r5);
}

