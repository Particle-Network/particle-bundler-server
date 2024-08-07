import { Injectable, Logger } from '@nestjs/common';
import { Contract, Network, WebSocketProvider } from 'ethers';
import { Helper } from '../../common/helper';
import { LarkService } from '../common/services/lark.service';
import { ENTRY_POINT_ADDRESS_V06, ENTRY_POINT_ADDRESS_V07, getBundlerChainConfig } from '../../configs/bundler-common';
import { EVM_CHAIN_ID } from '../../common/chains';
import { $enum } from 'ts-enum-util';
import { LRUCache } from 'lru-cache';
import { IS_PRODUCTION } from '../../common/common-types';
import { entryPointAbis } from '../rpc/aa/abis/entry-point-abis';

const WEBSOCKET_PING_INTERVAL = 5000;
const WEBSOCKET_PONG_TIMEOUT = 3000;
const WEBSOCKET_RECONNECT_DELAY = 100;

@Injectable()
export class ListenerService {
    private readonly cacheUserOpHashPendingTransaction: LRUCache<string, any> = new LRUCache({
        max: 100000,
        ttl: 60 * 1000,
    });

    public constructor(private readonly larkService: LarkService) {}

    private readonly wsProviders: Map<number, WebSocketProvider> = new Map();
    private eventHandler: (chainId: number, event: any) => {};

    public initialize(eventHandler: (event: any) => {}) {
        this.eventHandler = eventHandler;

        const chains = $enum(EVM_CHAIN_ID).values();
        for (const chainId of chains) {
            const bundlerConfig = getBundlerChainConfig(chainId);
            if (!!bundlerConfig.wsUrl) {
                this.listen(chainId, bundlerConfig.wsUrl);
            }
        }
    }

    private async listen(chainId: number, wsUrl: string) {
        const wsProvider = new WebSocketProvider(wsUrl, Network.from(chainId));
        let pingInterval: NodeJS.Timeout | undefined;
        let pongTimeout: NodeJS.Timeout | undefined;

        const websocket = wsProvider.websocket;

        (websocket as any).on('open', () => {
            console.log(`Listening on chain ${chainId} with ${wsUrl}`);

            pingInterval = setInterval(() => {
                (websocket as any).ping();

                pongTimeout = setTimeout(() => {
                    (websocket as any).terminate();
                }, WEBSOCKET_PONG_TIMEOUT);
            }, WEBSOCKET_PING_INTERVAL);

            this.onListen(chainId, wsProvider);
        });

        (websocket as any).on('pong', () => {
            if (pongTimeout) clearTimeout(pongTimeout);
        });

        (websocket as any).on('close', (code: number) => {
            console.error('WebSocketProvider websocket close', wsUrl, code);

            if (pingInterval) clearInterval(pingInterval);
            if (pongTimeout) clearTimeout(pongTimeout);

            if (code !== 1000) {
                setTimeout(() => this.listen(chainId, wsUrl), WEBSOCKET_RECONNECT_DELAY);
            }
        });

        (websocket as any).on('error', (data: any) => {
            console.error('WebSocketProvider websocket error', wsUrl, data);
            this.larkService.sendMessage(
                `Url: ${wsUrl}\n${Helper.converErrorToString(data)}`,
                `WebSocketProvider Websocket Error On Chain ${chainId}`,
            );
        });

        this.wsProviders.set(chainId, wsProvider);
    }

    private onListen(chainId: number, wsProvider: WebSocketProvider) {
        const contractV06 = new Contract(ENTRY_POINT_ADDRESS_V06, entryPointAbis.v06, wsProvider);
        contractV06.on('UserOperationEvent', (...event: any[]) => {
            try {
                const userOpHash = event[0];
                const key = this.keyChainIdUserOpHash(chainId, userOpHash);

                if (!!this.cacheUserOpHashPendingTransaction.get(key)) {
                    this.eventHandler(chainId, event);
                }
            } catch (error) {
                if (!IS_PRODUCTION) {
                    Logger.error(`[onListen UserOperationEvent Error]`, error);
                }
            }
        });

        const contractV07 = new Contract(ENTRY_POINT_ADDRESS_V07, entryPointAbis.v07, wsProvider);
        contractV07.on('UserOperationEvent', (...event: any[]) => {
            try {
                const userOpHash = event[0];
                const key = this.keyChainIdUserOpHash(chainId, userOpHash);

                if (!!this.cacheUserOpHashPendingTransaction.get(key)) {
                    this.eventHandler(chainId, event);
                }
            } catch (error) {
                if (!IS_PRODUCTION) {
                    Logger.error(`[onListen UserOperationEvent Error]`, error);
                }
            }
        });
    }

    public appendUserOpHashPendingTransactionMap(chainId: number, userOperationHashes: string[]) {
        for (const userOperationHash of userOperationHashes) {
            const key = this.keyChainIdUserOpHash(chainId, userOperationHash);
            this.cacheUserOpHashPendingTransaction.set(key, true);
        }
    }

    private keyChainIdUserOpHash(chainId: number, userOpHash: string): string {
        return `${chainId}_${userOpHash}`;
    }
}
