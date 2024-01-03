import * as pm2 from 'pm2';
import { IS_DEVELOPMENT, PROCESS_NOTIFY_TYPE } from './common-types';

const nodeIds = [];

pm2.connect(function () {
    pm2.list(function (err, processes) {
        for (const i in processes) {
            if (processes[i].name === 'particle-bundler-server') {
                nodeIds.push(processes[i].pm_id);
            }
        }
    });
});

class ProcessNotifyClass {
    private handlerMap: Map<string, Function[]> = new Map();

    public constructor() {
        process.on('message', this.onMessage.bind(this));
    }

    private onMessage(packet: any) {
        if (typeof packet !== 'object' || !packet?.type || !this.handlerMap.has(packet.type)) {
            return;
        }

        const handlers = this.handlerMap.get(packet.type);
        for (const handler of handlers) {
            handler(packet);
        }
    }

    public sendMessages(type: PROCESS_NOTIFY_TYPE, data: any = null) {
        if (IS_DEVELOPMENT) {
            this.onMessage({ type, data });
            return;
        }

        for (const nodeId of nodeIds) {
            pm2.sendDataToProcessId(
                nodeId,
                {
                    type,
                    data,
                    topic: true,
                },
                (err, res) => {
                    // nothing
                },
            );
        }
    }

    public registerHandler(type: string, handler: Function) {
        let handlers = [];
        if (this.handlerMap.has(type)) {
            handlers = this.handlerMap.get(type);
        }

        handlers.push(handler);
        this.handlerMap.set(type, handlers);
    }
}

export const ProcessNotify = new ProcessNotifyClass();
