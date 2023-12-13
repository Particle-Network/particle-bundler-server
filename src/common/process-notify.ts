import * as pm2 from 'pm2';
import { PROCESS_NOTIFY_TYPE } from './common-types';

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
    private handlers: Function[] = [];

    public constructor() {
        process.on('message', (packet: any) => {
            console.log('eeee', packet);

            if (typeof packet !== 'object' || !packet?.type) {
                return;
            }

            for (const handler of this.handlers) {
                handler(packet);
            }
        });
    }

    public sendToNodes(type: PROCESS_NOTIFY_TYPE, data: any = null) {
        console.log('fffff', nodeIds, type);

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

    public registerHandler(handler: Function) {
        this.handlers.push(handler);
    }
}

export const ProcessNotify = new ProcessNotifyClass();
