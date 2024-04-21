// import { Injectable } from '@nestjs/common';
// import { DEFAULT_ENTRY_POINT_ADDRESS, RPC_CONFIG } from '../../configs/bundler-common';
// import { Contract, Network, WebSocketProvider } from 'ethers';
// import entryPointAbi from '../rpc/aa/abis/entry-point-abi';
// import { TransactionDocument } from '../rpc/schemas/transaction.schema';
// import { Alert } from '../../common/alert';
// import { Helper } from '../../common/helper';

// const WEBSOCKET_PING_INTERVAL = 5000;
// const WEBSOCKET_PONG_TIMEOUT = 3000;
// const WEBSOCKET_RECONNECT_DELAY = 100;

// @Injectable()
// export class ListenerService {
//     private readonly wsProviders: Map<number, WebSocketProvider> = new Map();
//     private userOpHashPendingTransactionMap: Map<string, TransactionDocument> = new Map();
//     private eventHandler: (event: any, transaction: TransactionDocument) => {};

//     public initialize(eventHandler: (event: any, transaction: TransactionDocument) => {}) {
//         this.eventHandler = eventHandler;

//         const chains: any[] = Object.values(RPC_CONFIG);
//         for (const chainItem of chains) {
//             if (!!chainItem.wsUrl) {
//                 this.listen(chainItem.chainId, chainItem.wsUrl);
//             }
//         }
//     }

//     private async listen(chainId: number, wsUrl: string) {
//         const network = new Network('', chainId);
//         const wsProvider = new WebSocketProvider(wsUrl, network);
//         let pingInterval: NodeJS.Timeout | undefined;
//         let pongTimeout: NodeJS.Timeout | undefined;

//         const websocket = wsProvider.websocket;

//         (websocket as any).on('open', () => {
//             console.log(`Listening on chain ${chainId} with ${wsUrl}`);

//             pingInterval = setInterval(() => {
//                 (websocket as any).ping();

//                 pongTimeout = setTimeout(() => {
//                     (websocket as any).terminate();
//                 }, WEBSOCKET_PONG_TIMEOUT);
//             }, WEBSOCKET_PING_INTERVAL);

//             this.onListen(chainId, wsProvider);
//         });

//         (websocket as any).on('pong', () => {
//             if (pongTimeout) clearTimeout(pongTimeout);
//         });

//         (websocket as any).on('close', (code: number) => {
//             console.error('providerUrl', wsUrl);
//             console.error('WebSocketProvider websocket close', code);

//             if (pingInterval) clearInterval(pingInterval);
//             if (pongTimeout) clearTimeout(pongTimeout);

//             if (code !== 1000) {
//                 setTimeout(() => this.listen(chainId, wsUrl), WEBSOCKET_RECONNECT_DELAY);
//             }
//         });

//         (websocket as any).on('error', (data: any) => {
//             console.error('providerUrl', wsUrl);
//             console.error('WebSocketProvider websocket error', data);
//             Alert.sendMessage(`Url: ${wsUrl}\n${Helper.converErrorToString(data)}`, `WebSocketProvider Websocket Error On Chain ${chainId}`);
//         });

//         this.wsProviders.set(chainId, wsProvider);
//     }

//     private onListen(chainId: number, wsProvider: WebSocketProvider) {
//         const contract = new Contract(DEFAULT_ENTRY_POINT_ADDRESS, entryPointAbi, wsProvider);
//         contract.on('UserOperationEvent', (...event: any[]) => {
//             const userOpHash = event[0];
//             const key = this.keyChainIdUserOpHash(chainId, userOpHash);

//             if (this.userOpHashPendingTransactionMap.has(key)) {
//                 const transaction = this.userOpHashPendingTransactionMap.get(key);
//                 this.eventHandler(event, transaction);
//             }
//         });
//     }

//     public appendUserOpHashPendingTransactionMap(transaction: TransactionDocument) {
//         const userOperationHashes = transaction.userOperationHashes;

//         for (const userOperationHash of userOperationHashes) {
//             const key = this.keyChainIdUserOpHash(transaction.chainId, userOperationHash);
//             this.userOpHashPendingTransactionMap.set(key, transaction);

//             setTimeout(() => {
//                 this.userOpHashPendingTransactionMap.delete(key);
//             }, 60000);
//         }
//     }

//     private keyChainIdUserOpHash(chainId: number, userOpHash: string): string {
//         return `${chainId}_${userOpHash}`;
//     }
// }
