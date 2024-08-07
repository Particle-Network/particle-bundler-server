import { Test, TestingModule } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { RpcModule } from '../src/modules/rpc/rpc.module';
import { MongooseModule } from '@nestjs/mongoose';
import { mongodbConfigAsync } from '../src/configs/mongodb.config';
import { configConfig } from '../src/configs/config.config';
import { ConfigModule } from '@nestjs/config';
import { BUNDLER_CONFIG_MAP, getBundlerChainConfig, initializeBundlerConfig } from '../src/configs/bundler-common';
import {
    getDocumentId,
    getUserOpHashV06,
    getUserOpHashV07,
    packAccountGasLimits,
    splitOriginNonce,
    unpackAccountGasLimits,
    waitSeconds,
} from '../src/modules/rpc/aa/utils';
import { EVM_CHAIN_ID } from '../src/common/chains';
import { ChainService } from '../src/modules/rpc/services/chain.service';
import P2PCache from '../src/common/p2p-cache';
import { HandleLocalUserOperationService } from '../src/modules/task/handle-local-user-operation.service';
import { UserOperationService } from '../src/modules/rpc/services/user-operation.service';
import { TaskModule } from '../src/modules/task/task.module';
import { createUserOpRandomNonce } from './lib/utils';
import { SignerService } from '../src/modules/rpc/services/signer.service';
import { Wallet } from 'ethers';
import { TransactionService } from '../src/modules/rpc/services/transaction.service';
import { keyLockSigner } from '../src/common/common-types';
import { shuffle } from 'lodash';

let rpcController: RpcController;
let rpcService: RpcService;
let chainService: ChainService;
let userOperationService: UserOperationService;
let handleLocalUserOperationService: HandleLocalUserOperationService;
let signerService: SignerService;
let transactionService: TransactionService;

describe('Common', () => {
    beforeEach(async () => {
        await initializeBundlerConfig();

        const app: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot(configConfig),
                MongooseModule.forRootAsync(mongodbConfigAsync),
                RpcModule,
                TaskModule,
            ],
        }).compile();

        rpcController = app.get<RpcController>(RpcController);
        rpcService = app.get<RpcService>(RpcService);
        chainService = app.get<ChainService>(ChainService);
        userOperationService = app.get<UserOperationService>(UserOperationService);
        handleLocalUserOperationService = app.get<HandleLocalUserOperationService>(HandleLocalUserOperationService);
        signerService = app.get<SignerService>(SignerService);
        transactionService = app.get<TransactionService>(TransactionService);
    }, 60000);

    it('splitOriginNonce', async () => {
        const result = splitOriginNonce('0x77cd9ea7ae31472e833221cb26e9398e0000000000000003');
        expect(result.nonceKey).toBe('0x77cd9ea7ae31472e833221cb26e9398e');
        expect(result.nonceValue).toBe('0x03');
    }, 60000);

    it('getFeeDataFromParticle', async () => {
        let feeData = await chainService.getFeeDataIfCache(EVM_CHAIN_ID.TAIKO_MAINNET);
        console.log('feeData', feeData);
        expect(feeData.baseFee).toBe(1);

        feeData = await chainService.getFeeDataIfCache(EVM_CHAIN_ID.MERLIN_CHAIN_MAINNET);
        expect(feeData.maxPriorityFeePerGas).toBe(50000000);
        expect(feeData.maxFeePerGas).toBe(50000000);
        expect(feeData.gasPrice).toBe(50000000);

        const cacheKey = chainService.keyCacheChainFeeData(EVM_CHAIN_ID.TAIKO_MAINNET);
        expect(P2PCache.has(cacheKey)).toBeTruthy();
    }, 60000);

    it('tryLockUserOperationsAndGetUnuseds', async () => {
        const userOperationDocument = createFakeUserOperationDocument();
        let unusedUserOperations = handleLocalUserOperationService.tryLockUserOperationsAndGetUnuseds([userOperationDocument]);
        expect(unusedUserOperations.length).toBe(1);
        expect(getDocumentId(unusedUserOperations[0])).toBe(getDocumentId(userOperationDocument));

        unusedUserOperations = handleLocalUserOperationService.tryLockUserOperationsAndGetUnuseds([userOperationDocument]);
        expect(unusedUserOperations.length).toBe(0);

        handleLocalUserOperationService.unlockUserOperations([userOperationDocument]);
        unusedUserOperations = handleLocalUserOperationService.tryLockUserOperationsAndGetUnuseds([userOperationDocument]);
        expect(unusedUserOperations.length).toBe(1);
    }, 60000);

    it('groupByUserOperationsByChainId', async () => {
        const userOperationDocumentOn1 = createFakeUserOperationDocument({ chainId: 1 });
        const userOperationDocumentOn2 = createFakeUserOperationDocument({ chainId: 2 });
        const userOperationsByChainId = handleLocalUserOperationService.groupByUserOperationsByChainId([
            userOperationDocumentOn1,
            userOperationDocumentOn2,
        ]);
        console.log('userOperationsByChainId', userOperationsByChainId);
        expect(userOperationsByChainId[1].length).toBe(1);
        expect(userOperationsByChainId[2].length).toBe(1);
    }, 60000);

    it('pickAvailableSigners', async () => {
        const signers: Wallet[] = [];
        for (let index = 0; index < 50; index++) {
            signers.push(new Wallet(Wallet.createRandom().privateKey));
        }

        process.env.BUNDLER_SIGNERS_99999 = signers.map((s) => s.privateKey).join(',');
        const randomSigners = signerService.getRandomValidSigners(99999);
        expect(randomSigners.length).toBe(50);

        transactionService.getPendingTransactionCountBySigner = async (chainId: number, signerAddress: string): Promise<number> => {
            return signers.findIndex((s) => s.address === signerAddress);
        };

        BUNDLER_CONFIG_MAP[99999] = { pendingTransactionSignerHandleLimit: 10 }; // override
        const bundlerConfig = getBundlerChainConfig(99999);
        let availableSigners = await handleLocalUserOperationService.pickAvailableSigners(99999);
        console.log('availableSigners', availableSigners);
        expect(availableSigners.length).toBe(Math.ceil(signers.length / 5));
        for (let index = 0; index < availableSigners.length; index++) {
            const availableSigner = availableSigners[index];
            expect(availableSigner.signer.address).toBe(signers[index].address);
            expect(availableSigner.availableTxCount).toBe(bundlerConfig.pendingTransactionSignerHandleLimit - index);
            expect(handleLocalUserOperationService.lockChainSigner.has(keyLockSigner(99999, availableSigner.signer.address))).toBeTruthy();
        }

        availableSigners = await handleLocalUserOperationService.pickAvailableSigners(99999);
        expect(availableSigners.length).toBe(0);
    }, 60000);

    it('packUserOperationsForSigner', async () => {
        const signers: Wallet[] = [];
        for (let index = 0; index < 50; index++) {
            signers.push(new Wallet(Wallet.createRandom().privateKey));
        }

        process.env.BUNDLER_SIGNERS_99999 = signers.map((s) => s.privateKey).join(',');
        transactionService.getPendingTransactionCountBySigner = async (chainId: number, signerAddress: string): Promise<number> => {
            return signers.findIndex((s) => s.address === signerAddress);
        };

        BUNDLER_CONFIG_MAP[99999] = { pendingTransactionSignerHandleLimit: 10, maxUserOpPackCount: 1 }; // override
        const availableSigners = await handleLocalUserOperationService.pickAvailableSigners(99999);

        const userOperationDocument = createFakeUserOperationDocument();
        await waitSeconds(0.001);
        const userOperationDocument2 = createFakeUserOperationDocument();
        const userOperationDocuments = shuffle([userOperationDocument2, userOperationDocument]);
        let { packedBundles, unusedUserOperations, userOperationsToDelete } = handleLocalUserOperationService.packUserOperationsForSigner(
            99999,
            userOperationDocuments,
            availableSigners,
        );
        console.log('packedBundles', packedBundles);
        expect(packedBundles.length).toBe(2);
        expect(packedBundles[0].address).toBe(availableSigners[0].signer.address);
        expect(packedBundles[1].address).toBe(availableSigners[1].signer.address);
        expect(packedBundles[0].bundles.length).toBe(1);
        expect(packedBundles[1].bundles.length).toBe(1);
        expect(packedBundles[0].bundles[0].userOperations[0].userOpHash).toBe(userOperationDocument.userOpHash);
        expect(packedBundles[1].bundles[0].userOperations[0].userOpHash).toBe(userOperationDocument2.userOpHash);
        expect(unusedUserOperations.length).toBe(0);
        expect(userOperationsToDelete.length).toBe(0);

        const u = packedBundles.map((packedBundle) => packedBundle.bundles.map((bundle) => bundle.userOperations).flat()).flat();
        expect(u.length).toBe(2);

        const r2 = handleLocalUserOperationService.packUserOperationsForSigner(99999, userOperationDocuments, [availableSigners[0]]);
        expect(r2.packedBundles.length).toBe(1);
        expect(r2.packedBundles[0].bundles.length).toBe(2);

        BUNDLER_CONFIG_MAP[99999].maxBundleGas = 1;
        const r3 = handleLocalUserOperationService.packUserOperationsForSigner(99999, userOperationDocuments, [availableSigners[0]]);
        expect(r3.userOperationsToDelete.length).toBe(2);

        BUNDLER_CONFIG_MAP[99999].maxBundleGas = Number.MAX_SAFE_INTEGER;
        availableSigners[0].availableTxCount = 1;
        const r4 = handleLocalUserOperationService.packUserOperationsForSigner(99999, userOperationDocuments, [availableSigners[0]]);

        expect(r4.unusedUserOperations.length).toBe(1);
        expect(r4.unusedUserOperations[0].userOpHash).toBe(userOperationDocument2.userOpHash);
    }, 60000);

    it('packAccountGasLimits', async () => {
        const a = 123n;
        const b = 888n;

        expect(packAccountGasLimits(a, b)).toBe('0x0000000000000000000000000000007b00000000000000000000000000000378');
        const { verificationGasLimit, callGasLimit } = unpackAccountGasLimits(
            '0x0000000000000000000000000000007b00000000000000000000000000000378',
        );

        expect(verificationGasLimit).toBe(123n);
        expect(callGasLimit).toBe(888n);
    }, 60000);
});

function createFakeUserOperationDocument(options: any = {}) {
    const nonce = options?.nonce ?? createUserOpRandomNonce();
    const { nonceKey, nonceValue } = splitOriginNonce(nonce);
    const nonceValueString = BigInt(nonceValue).toString();

    const chainId = options?.chainId ?? 1;
    const fakeUserOp = {
        sender: '0x59ADfb442e4975b48dB2e12cd76BdC825491A4C2',
        nonce,
        initCode: '0x',
        callData:
            '0x0000189a0000000000000000000000007543770a652e602855e3672ccc7e58ba9ed67f980000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001a4cddd29be00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000666dc7db9ae1c6d19216bf8100000000000000000000000000000000000000000000000000000000000000a00000000000000000000000007ddd4989abb3cda01ba31ac283c194852e42e1a800000000000000000000000000000000000000000000000000000000666dca350000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d31822d7937220600000000000000000000000000000000000000000000000000000000000000410e44ddd2938a748775b42fbb38bbd8a2d2a1f9bb4a23efc264d28bc600862df47a28620c1edd13d1de1ddeed116e1249ef1ca0a1f282142f09a5a732c4bfc3671b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        paymasterAndData:
            '0x8817340e0a3435e06254f2ed411e6418cd070d6f00000000000000000000000000000000000000000000000000000000666dca3000000000000000000000000000000000000000000000000000000000000000004ee24dca46212df2abaff05172151c956782c6f43a6f8cc874ec5cebd3451b8b680e2ed2cddf31be88f1ddd189cebf5da5931e6319bee9d1c54cfa4b19b9f6391c',
        signature:
            '0x00000000000000000000000000000000000000000000000000000000000000400000000000000000000000001965cd0Bf68Db7D007613E79d8386d48B9061ea6000000000000000000000000000000000000000000000000000000000000004181d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b00000000000000000000000000000000000000000000000000000000000000',
        preVerificationGas: '0xd590',
        verificationGasLimit: '0x1e573',
        callGasLimit: '0x0249f0',
        maxFeePerGas: '0xdc4c7c7',
        maxPriorityFeePerGas: '0x7365040',
    };

    const entryPoint = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
    const userOpHash = getUserOpHashV06(chainId, fakeUserOp, entryPoint);

    return new userOperationService.userOperationModel({
        userOpHash: userOpHash,
        userOpSender: fakeUserOp.sender,
        userOpNonceKey: nonceKey,
        userOpNonce: nonceValueString,
        chainId,
        entryPoint,
        origin: fakeUserOp,
        status: USER_OPERATION_STATUS.LOCAL,
    });
}
