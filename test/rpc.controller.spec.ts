import { Test } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { Wallet, JsonRpcProvider, resolveProperties, toBeHex, Contract } from 'ethers';
import {
    AA_METHODS,
    initializeBundlerConfig,
    getBundlerChainConfig,
    ENTRY_POINT_ADDRESS_V06,
    ENTRY_POINT_ADDRESS_V07,
} from '../src/configs/bundler-common';
import { deepHexlify } from '../src/modules/rpc/aa/utils';
import { IContractAccount } from '../src/modules/rpc/aa/interface-contract-account';
import { gaslessSponsor } from './lib/common';
import { deserializeUserOpCalldata } from '../src/modules/rpc/aa/deserialize-user-op';
import { SimpleSmartAccountV06 } from './lib/simple-smart-account-v06';
import { EVM_CHAIN_ID } from '../src/common/chains';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { SimpleSmartAccountV07 } from './lib/simple-smart-account-v07';

let rpcController: RpcController;
let rpcService: RpcService;

process.env.DISABLE_TASK = '1';

let app: INestApplication;
describe('RpcController', () => {
    beforeEach(async () => {
        await initializeBundlerConfig();

        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.init();

        rpcController = app.get<RpcController>(RpcController);
        rpcService = app.get<RpcService>(RpcService);
    }, 60000);

    describe('basic', () => {
        it('Gasless Basic Single V06', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);
            console.log('Test chainId', chainId);

            const simpleAccount = await createSimpleAccountV06(chainId);
            let userOp = await createFakeUserOp(chainId, simpleAccount);

            console.log('unsignedUserOp', deepHexlify(userOp));

            userOp = await estimateGasV06(chainId, userOp);
            console.log('estimateGas', JSON.stringify(deepHexlify(userOp)));

            userOp = await gaslessSponsor(chainId, userOp, ENTRY_POINT_ADDRESS_V06);
            console.log('sponsoredOp', deepHexlify(userOp));

            userOp.signature = await getSignature(simpleAccount, userOp);
            console.log('signedOp', deepHexlify(userOp));

            await sendUserOp(chainId, userOp);
        }, 60000);

        it('Gasless Basic Single V07', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);
            console.log('Test chainId', chainId);

            const simpleAccount = await createSimpleAccountV07(chainId);
            let userOp = await createFakeUserOp(chainId, simpleAccount);

            // dummy paymasterAndData
            userOp.paymasterAndData =
                '0xbdb4d240062bc461797ee9a4d9193a466443e187000000000000000000000000000186a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000066b06c280000000000000000000000000000000000000000000000000000000000000000945b9dc51c8176e756f17e94c819531db508a53f856cb767698611ace21f86242b8c26967e76526d28301d5d3f16651977d3728b16d4e28c9e6505c92581a7071c';

            console.log('unsignedUserOp', deepHexlify(userOp));

            userOp = await estimateGasV07(chainId, userOp, ENTRY_POINT_ADDRESS_V07);
            console.log('estimateGas', JSON.stringify(deepHexlify(userOp)));

            userOp = await gaslessSponsor(chainId, userOp, ENTRY_POINT_ADDRESS_V07);
            console.log('sponsoredOp', deepHexlify(userOp));

            userOp.signature = await getSignature(simpleAccount, userOp);
            console.log('signedOp', deepHexlify(userOp));

            await sendUserOp(chainId, userOp, ENTRY_POINT_ADDRESS_V07);
        }, 60000);

        it('Gasless Basic Batch', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);
            console.log('Test chainId', chainId);

            const simpleAccount1 = await createSimpleAccountV06(chainId);
            let userOp1 = await createFakeUserOp(chainId, simpleAccount1);
            const simpleAccount2 = await createSimpleAccountV06(chainId);
            let userOp2 = await createFakeUserOp(chainId, simpleAccount2);

            const userOps = [];
            for (let item of [
                { userOp: userOp1, simpleAccount: simpleAccount1 },
                { userOp: userOp2, simpleAccount: simpleAccount2 },
            ]) {
                let userOp = item.userOp;
                console.log('unsignedUserOp', deepHexlify(userOp));
                userOp = await estimateGasV06(chainId, userOp);
                console.log('estimateGas', JSON.stringify(deepHexlify(userOp)));

                userOp = await gaslessSponsor(chainId, userOp, ENTRY_POINT_ADDRESS_V06);
                console.log('sponsoredOp', deepHexlify(userOp));

                userOp.signature = await getSignature(item.simpleAccount, userOp);
                console.log('signedOp', deepHexlify(userOp));

                userOps.push(userOp);
            }

            await sendUserOpBatch(chainId, userOps);
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

async function createSimpleAccountV06(chainId: number): Promise<IContractAccount> {
    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl, null, { batchMaxCount: 1 });

    const owner: Wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    return new SimpleSmartAccountV06(owner);
}

async function createSimpleAccountV07(chainId: number): Promise<IContractAccount> {
    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl, null, { batchMaxCount: 1 });

    const owner: Wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    return new SimpleSmartAccountV07(owner);
}

async function createFakeUserOp(chainId: number, simpleAccount: IContractAccount) {
    const unsignedUserOp = await simpleAccount.createUnsignedUserOp([
        {
            to: Wallet.createRandom().address,
            value: toBeHex(0),
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

async function estimateGasV06(chainId: number, userOp: any, entryPoint: string = ENTRY_POINT_ADDRESS_V06) {
    const bodyEstimate = {
        method: AA_METHODS.ESTIMATE_USER_OPERATION_GAS,
        params: [userOp, entryPoint],
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

async function estimateGasV07(chainId: number, userOp: any, entryPoint: string = ENTRY_POINT_ADDRESS_V06) {
    const bodyEstimate = {
        method: AA_METHODS.ESTIMATE_USER_OPERATION_GAS,
        params: [userOp, entryPoint],
    };

    const rEstimate = await rpcController.handleRpc(chainId, bodyEstimate);
    console.log('rEstimate', rEstimate);

    userOp.accountGasLimits = rEstimate.result.accountGasLimits;
    userOp.gasFees = rEstimate.result.gasFees;
    userOp.preVerificationGas = rEstimate.result.preVerificationGas;

    return deepHexlify(userOp);
}

async function sendUserOp(chainId: number, userOp: any, entryPoint: string = ENTRY_POINT_ADDRESS_V06) {
    const bodySend = {
        method: AA_METHODS.SEND_USER_OPERATION,
        params: [userOp, entryPoint],
    };

    let r3: any = await request(app.getHttpServer()).post('').query({ chainId }).auth('test_user', 'test_pass').send(bodySend);
    console.log('r3', r3.text);

    r3 = JSON.parse(r3.text);
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

async function sendUserOpBatch(chainId: number, userOps: any[]) {
    const bodySend = {
        method: AA_METHODS.SEND_USER_OPERATION_BATCH,
        params: [userOps, ENTRY_POINT_ADDRESS_V06],
    };

    let r3: any = await request(app.getHttpServer()).post('').query({ chainId }).auth('test_user', 'test_pass').send(bodySend);
    console.log('r3', r3.text);
}
