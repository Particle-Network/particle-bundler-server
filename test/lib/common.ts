import { deepHexlify } from '../../src/modules/rpc/aa/utils';
import Axios from 'axios';

export const PARTICLE_PAYMASTER_URL = 'https://paymaster.particle.network';

// TODO fit for public dev ?
export async function gaslessSponsor(chainId: number, userOp: any, entryPoint: string) {
    const bodySponsor = {
        method: 'pm_sponsorUserOperation',
        params: [userOp, entryPoint],
    };

    const rSponsor = await Axios.post(PARTICLE_PAYMASTER_URL, bodySponsor, {
        params: {
            chainId,
            projectUuid: process.env.PARTICLE_PROJECT_ID,
            projectKey: process.env.PARTICLE_PROJECT_CLIENT_KEY,
        },
    });

    userOp.paymasterAndData = rSponsor.data.result.paymasterAndData;

    return deepHexlify(userOp);
}
