import { Test } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { Wallet, JsonRpcProvider, resolveProperties, toBeHex, Contract, Interface, solidityPacked } from 'ethers';
import {
    AA_METHODS,
    initializeBundlerConfig,
    getBundlerChainConfig,
    ENTRY_POINT_ADDRESS_V06,
    ENTRY_POINT_ADDRESS_V07,
} from '../src/configs/bundler-common';
import { deepHexlify } from '../src/modules/rpc/aa/utils';
import { gaslessSponsor } from './lib/common';
import { deserializeUserOpCalldata } from '../src/modules/rpc/aa/deserialize-user-op';
import { SimpleSmartAccountV06 } from './lib/simple-smart-account-v06';
import { EVM_CHAIN_ID } from '../src/common/chains';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { SimpleSmartAccountV07 } from './lib/simple-smart-account-v07';
import { CoinbaseSmartAccount } from './lib/coinbase-smart-account';
import { IContractAccount } from './lib/interface-contract-account';
import { DUMMY_SIGNATURE } from '../src/common/common-types';

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

        it('Gasless Coinbase Single V06', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);
            console.log('Test chainId', chainId);

            const smartAccount = await createCoinbaseAccountV06(chainId);
            console.log('smartAccount', await smartAccount.getAccountAddress());

            let userOp = await createFakeUserOp(chainId, smartAccount);
            console.log('unsignedUserOp', deepHexlify(userOp));

            const SignatureWrapperStruct = '(uint256 ownerIndex, bytes signatureData)';

            const iface = new Interface([`function encode(${SignatureWrapperStruct} calldata) external`]);
            let data = iface.encodeFunctionData('encode', [
                {
                    ownerIndex: 0,
                    signatureData: DUMMY_SIGNATURE,
                },
            ]);

            userOp.signature = `0x${data.slice(10)}`;
            userOp = await estimateGasV06(chainId, userOp);
            console.log('estimateGas', JSON.stringify(deepHexlify(userOp)));

            userOp = await gaslessSponsor(chainId, userOp, ENTRY_POINT_ADDRESS_V06);
            console.log('sponsoredOp', deepHexlify(userOp));

            let signature = await getSignature(smartAccount, userOp);
            data = iface.encodeFunctionData('encode', [
                {
                    ownerIndex: 0,
                    signatureData: signature,
                },
            ]);

            userOp.signature = `0x${data.slice(10)}`;
            console.log('signedOp', deepHexlify(userOp));

            await sendUserOp(chainId, userOp);
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

            const body = {
                method: 'eth_estimateUserOperationGas',
                params: [
                    {
                        sender: '0xD15C6F010A6290F07B76d6EBF597131D718e31aC',
                        nonce: '0xba45a2bfb8de3d24ca9d7f1b551e14dff5d690fd00000000000000000000',
                        initCode:
                            '0xf320ebd311c2650f574f98f3318a1cd204d873eeea6d13ac0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001643c3b752b01ba45a2bfb8de3d24ca9d7f1b551e14dff5d690fd0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000060ca20a775121ae8236c0a4cd3637af7c5fb073f3ac97535d4db4d00711863fcb20e37680ddba1c1bb281fe2663419ea7f3182bb36c12d9fb433897b63b522bdd1405c8b2b96fe7379aa174f8f045f46a7befe89bbc033d9a52e8e9d93aeb9942a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                        callData: '0x',
                        signature:
                            '0x00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000013bf49e4ae982ae78f678ef764aa2de1a0b0e39aa9e55ab3ac60d73ef3d855d37259c20f47b8ddcb8967bdd2dc12a18e5013458c80993c44d46b6824920085d050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22505262336e6452335a3655455464582d4f79346e5775496e4265674e32585f6365336d5939513366366830222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a38303831222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000000000',
                        paymasterAndData: '0x',
                    },
                    '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
                ],
                id: 53,
                jsonrpc: '2.0',
            };

            const r = await rpcController.handleRpc(111557560, body);
            console.log('r', r);
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

async function createCoinbaseAccountV06(chainId: number): Promise<IContractAccount> {
    const rpcUrl = getBundlerChainConfig(chainId).rpcUrl;
    const provider = new JsonRpcProvider(rpcUrl, null, { batchMaxCount: 1 });

    const owner: Wallet = new Wallet(Wallet.createRandom().privateKey, provider);
    return new CoinbaseSmartAccount(owner);
}

async function createFakeUserOp(chainId: number, smartAccount: IContractAccount) {
    const unsignedUserOp = await smartAccount.createUnsignedUserOp([
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
