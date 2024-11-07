import { Test } from '@nestjs/testing';
import { RpcController } from '../src/modules/rpc/rpc.controller';
import { RpcService } from '../src/modules/rpc/services/rpc.service';
import { initializeBundlerConfig } from '../src/configs/bundler-common';
import { AppModule } from '../src/app.module';
import { INestApplication } from '@nestjs/common';
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { EVM_CHAIN_ID } from '../src/common/chains';
import { randomUUID } from 'crypto';

let rpcController: RpcController;
let rpcService: RpcService;

process.env.DISABLE_TASK = '1';

let app: INestApplication;

const connection = new Connection('https://white-lively-shadow.solana-devnet.quiknode.pro/786595c0c8b84b4d19e34e0db89d3f0dc843793b/');

// xmXUT7numvmxMmZUa5h5H3YcAKwGYtAQTMEDEAx7hgG
export const keypairXMX = Keypair.fromSecretKey(
    Buffer.from([
        190, 162, 132, 149, 21, 12, 174, 21, 115, 15, 54, 94, 54, 205, 88, 188, 38, 37, 193, 89, 197, 62, 162, 253, 171, 115, 62, 229, 196, 234,
        37, 199, 14, 73, 74, 30, 179, 235, 233, 194, 155, 243, 23, 228, 41, 73, 42, 73, 112, 136, 106, 176, 142, 249, 58, 156, 254, 154, 144,
        150, 196, 160, 152, 197,
    ]),
);

describe('Solana', () => {
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

    it('sendTransaction', async () => {
        const recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

        const transactionMessage = new TransactionMessage({
            payerKey: keypairXMX.publicKey,
            instructions: [
                SystemProgram.transfer({
                    fromPubkey: keypairXMX.publicKey,
                    toPubkey: keypairXMX.publicKey,
                    lamports: 0.0001 * LAMPORTS_PER_SOL,
                }),
            ],
            recentBlockhash,
        });

        const v0Message = transactionMessage.compileToV0Message();

        const transaction = new VersionedTransaction(v0Message);

        transaction.sign([keypairXMX]);

        const serializedTransaction = transaction.serialize();

        console.log('serializedTransaction', serializedTransaction);

        const base64 = Buffer.from(serializedTransaction).toString('base64');

        console.log('base64', base64);

        const chainId = EVM_CHAIN_ID.SOLANA_DEVNET;
        const userOpHash = randomUUID();
        const rSendTransaction = await rpcController.handleRpc(chainId, {
            method: 'solana_sendTransaction',
            params: [{ userOpHash, serializedTransaction: base64, expiredAt: Math.floor(Date.now() / 1000) + 10 }],
            isAuth: true,
        });
        console.log('rSendTransaction', rSendTransaction);
    }, 60000);
});
