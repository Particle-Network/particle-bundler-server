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
import { deepHexlify } from '../src/modules/rpc/aa/utils';
import { IContractAccount } from '../src/modules/rpc/aa/interface-contract-account';
import { BigNumber } from '../src/common/bignumber';
import { ENTRY_POINT, gaslessSponsor } from './lib/common';
import { deserializeUserOpCalldata } from '../src/modules/rpc/aa/deserialize-user-op';
import { SimpleSmartAccount } from './lib/simple-smart-account';
import { EVM_CHAIN_ID } from '../src/common/chains';

let rpcController: RpcController;
let rpcService: RpcService;

process.env.DISABLE_TASK = '1';
process.env.ENVIRONMENT = 'dev';

describe('RpcController', () => {
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

    describe('basic', () => {
        it('Gasless Basic', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);
            console.log('Test chainId', chainId);

            const simpleAccount = await createSimpleAccount(chainId);
            let userOp = await createFakeUserOp(chainId, simpleAccount);

            console.log('unsignedUserOp', deepHexlify(userOp));

            userOp = await estimateGas(chainId, userOp);
            console.log('estimateGas', JSON.stringify(deepHexlify(userOp)));

            userOp = await gaslessSponsor(chainId, userOp, rpcController);
            console.log('sponsoredOp', deepHexlify(userOp));

            userOp.signature = await getSignature(simpleAccount, userOp);
            console.log('signedOp', deepHexlify(userOp));

            await sendUserOp(chainId, userOp);
        }, 60000);

        it('Test UserOP', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);
            console.log('Test chainId', chainId);

            // const body = {
            //     method: 'eth_sendUserOperation',
            //     params: [
            //         {
            //             sender: '0xE3E1A5eEc1c8d89C01e65a1da14403B1FEA71165',
            //             nonce: '0x00',
            //             initCode:
            //                 '0xaee9762ce625e0a8f7b184670fb57c37bfe1d0f1296601cd000000000000000000000000417f5a41305ddc99d18b5e176521b468b2a31b8600000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001448a552bd915d6371fc9a585875212cc5cc80e724000000000000000000000000',
            //             callData:
            //                 '0x51945447000000000000000000000000e4a1e73f367761224d10f801f7f0940dd97dcb090000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            //             callGasLimit: '0x0b5658',
            //             paymasterAndData:
            //                 '0x4a0febaa503b3395c9bcf70230a957c3d8e80266000000000000000000000000000000000000000000000000000000006554b38300000000000000000000000000000000000000000000000000000000000000003a5a95fc82182463319d753220d6bfc492d6ca7d453134b5199018434f1f12eb0fcfc13edf34597d3dc4f2fe1ccc019221755ddc1e3cd7709fb7a443abc394911b',
            //             signature:
            //                 '0x7ef326ee2b5365499c45aa83d37481d352285f4394c7a4411c7783f846c4886129cac9a4e8e2491fc21a36c964a79b2353a75765116cb22fe5a22fe563bc1ba91c',
            //             verificationGasLimit: '0x1c588d',
            //             maxFeePerGas: '0x08583b00',
            //             maxPriorityFeePerGas: '0x4c4b40',
            //             preVerificationGas: '0x34da84',
            //         },
            //         '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
            //     ],
            //     id: 53,
            //     jsonrpc: '2.0',
            // };

            // const r = await rpcController.handleRpc(chainId, body);
            // console.log('r', r);
        }, 60000);

        it('Decode callData', async () => {
            const txs = deserializeUserOpCalldata(
                '0xb61d27f600000000000000000000000028ad6b7dfd79153659cb44c2155cf7c0e1ceeccc00000000000000000000000000000000000000000000000002dfc714caeaf00000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000084c3685f4900000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000022314c57665a4a3653756e784748376353625a6f51364a655477456776593241435a6100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            );
            console.log('txs', txs);
        }, 60000);
    });
});

async function createSimpleAccount(chainId: number): Promise<IContractAccount> {
    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl, null, { batchMaxCount: 1 });

    const owner: Wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    return new SimpleSmartAccount(owner);
}

async function createFakeUserOp(chainId: number, simpleAccount: IContractAccount) {
    const unsignedUserOp = await simpleAccount.createUnsignedUserOp([
        {
            to: Wallet.createRandom().address,
            value: BigNumber.from(parseEther('0')).toHexString(),
            data: '0x',
        },
    ]);
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

    userOp.preVerificationGas = rEstimate.result.preVerificationGas;
    userOp.verificationGasLimit = rEstimate.result.verificationGasLimit;
    userOp.callGasLimit = rEstimate.result.callGasLimit;
    userOp.maxFeePerGas = rEstimate.result.maxFeePerGas;
    userOp.maxPriorityFeePerGas = rEstimate.result.maxPriorityFeePerGas;

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

    for (let index = 0; index < 30; index++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const bodyReceipt = {
            method: AA_METHODS.GET_USER_OPERATION_RECEIPT,
            params: [r3.result],
        };

        const r4 = await rpcController.handleRpc(chainId, bodyReceipt);
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
