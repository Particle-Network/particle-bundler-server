import { Test } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { Wallet, JsonRpcProvider, resolveProperties, toBeHex } from 'ethers';
import { AA_METHODS, getBundlerChainConfig, initializeBundlerConfig } from '../src/configs/bundler-common';
import { deepHexlify } from '../src/modules/rpc/aa/utils';
import { IContractAccount } from '../src/modules/rpc/aa/interface-contract-account';
import { ENTRY_POINT, gaslessSponsor } from './lib/common';
import { SimpleSmartAccount } from './lib/simple-smart-account';
import { EVM_CHAIN_ID } from '../src/common/chains';
import { AppModule } from '../src/app.module';
import Axios from 'axios';
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';

Axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });
Axios.defaults.httpAgent = new http.Agent({ keepAlive: true });

const BUNDLER_URL = 'http://localhost:3001';

let rpcController: RpcController;
let rpcService: RpcService;

process.env.DISABLE_TASK = '1';
process.env.ENVIRONMENT = 'dev';

let app: INestApplication;

describe('Benchmark', () => {
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
        it('Gasless Basic', async () => {
            const customChainId = process.argv.find((arg) => arg.includes('--chainId='));
            const chainId = Number(customChainId ? customChainId.split('=')[1] : EVM_CHAIN_ID.ETHEREUM_SEPOLIA_TESTNET);

            const promises = [];
            for (let index = 0; index < 10; index++) {
                promises.push(createAndExecuteUserOp(chainId));
            }

            const userOps = await Promise.all(promises);
            await Promise.all(
                userOps.map(async (userOp) => {
                    await sendUserOp(chainId, userOp);
                }),
            );
        }, 60000);
    });
});

async function createAndExecuteUserOp(chainId: number) {
    const simpleAccount = await createSimpleAccount(chainId);
    let userOp = await createFakeUserOp(chainId, simpleAccount);
    userOp = await estimateGas(chainId, userOp);
    userOp = await gaslessSponsor(chainId, userOp, rpcController);
    userOp.signature = await getSignature(simpleAccount, userOp);

    return userOp;
}

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
            value: toBeHex(0),
            data: '0x',
        },
    ]);
    return deepHexlify(await resolveProperties(unsignedUserOp));
}

async function getSignature(accountApi: IContractAccount, userOp: any) {
    const userOpHash = await accountApi.getUserOpHash(userOp);
    const signature = await accountApi.signUserOpHash(userOpHash);

    return signature;
}

async function estimateGas(chainId: number, userOp: any) {
    delete userOp.callGasLimit;
    delete userOp.verificationGasLimit;
    delete userOp.preVerificationGas;

    const response = await Axios.post(`${BUNDLER_URL}?chainId=${chainId}`, {
        method: AA_METHODS.ESTIMATE_USER_OPERATION_GAS,
        params: [userOp, ENTRY_POINT],
    });

    const rEstimate = response.data;

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

    const response = await Axios.post(`${BUNDLER_URL}?chainId=${chainId}`, bodySend);
    console.log('sendUserOp', response.data);

    const userOpHash = response.data.result;

    for (let index = 0; index < 30; index++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const bodyReceipt = {
            method: AA_METHODS.GET_USER_OPERATION_RECEIPT,
            params: [userOpHash],
        };

        const response2 = await Axios.post(`${BUNDLER_URL}?chainId=${chainId}`, bodyReceipt);
        if (!!response2.data.result) {
            console.log('receipt result', response.data.result, response2.data?.result?.receipt?.transactionHash);
            break;
        }
    }
}
