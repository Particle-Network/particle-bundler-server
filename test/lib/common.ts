import { RpcController } from '../../src/modules/rpc/rpc.controller';
import { deepHexlify } from '../../src/modules/rpc/aa/utils';
import Axios from 'axios';

export const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
export const PARTICLE_PAYMASTER_URL = 'https://paymaster.particle.network';

// TODO fit for public dev ?
export async function gaslessSponsor(chainId: number, userOp: any, rpcController?: RpcController) {
    const bodySponsor = {
        method: 'pm_sponsorUserOperation',
        params: [userOp, ENTRY_POINT],
    };

    const rSponsor = await Axios.post(PARTICLE_PAYMASTER_URL, bodySponsor, {
        params: {
            chainId,
            projectUuid: process.env.PARTICLE_PROJECT_KEY,
            projectKey: process.env.PARTICLE_CLIENT_KEY,
        },
    });
    userOp.paymasterAndData = rSponsor.data.result.paymasterAndData;

    return deepHexlify(userOp);
}
