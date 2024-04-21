import * as pm2 from 'pm2';
import { IS_DEVELOPMENT, SERVER_NAME } from './common-types';
import { LRUCache } from 'lru-cache';

const nodeIds = [];

pm2.connect(function () {
    pm2.list(function (err, processes) {
        for (const i in processes) {
            if (processes[i].name === SERVER_NAME) {
                nodeIds.push(processes[i].pm_id);
            }
        }
    });
});

class P2PCacheInstance {
    private readonly cache: LRUCache<string, any> = new LRUCache({
        max: 100000,
        ttl: 1000 * 60 * 60 * 24, // 1 day
    });

    public constructor() {
        process.on('message', this.onMessage.bind(this));
    }

    private onMessage(packet: any) {
        if (typeof packet !== 'object' || !packet?.key || !packet?.value) {
            return;
        }

        this.cache.set(packet.key, packet.value);
    }

    public set(key: string, value: any) {
        if (IS_DEVELOPMENT) {
            this.onMessage({ key, value });
            return;
        }

        for (const nodeId of nodeIds) {
            pm2.sendDataToProcessId(
                nodeId,
                {
                    key,
                    value,
                },
                (err, res) => {
                    // nothing
                },
            );
        }
    }

    public get(key: string) {
        return this.cache.get(key);
    }

    public has(key: string): boolean {
        return this.cache.has(key);
    }
}

const P2PCache = new P2PCacheInstance();
export default P2PCache;
