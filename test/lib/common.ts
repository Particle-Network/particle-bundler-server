import { RpcController } from '../../src/modules/rpc/rpc.controller';
import { deepHexlify } from '../../src/modules/rpc/aa/utils';
import Axios from 'axios';

export const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
export const PARTICLE_PAYMASTER_URL = 'https://paymaster.particle.network';

// TODO fit for public dev ?
export async function gaslessSponsor(chainId: number, userOp: any, rpcController?: RpcController) {
    let particlePaymasterUrl = `${PARTICLE_PAYMASTER_URL}?chainId=${chainId}`;
    if (!!process.env.PARTICLE_PAYMASTER_URL) {
        particlePaymasterUrl = `${process.env.PARTICLE_PAYMASTER_URL}&chainId=${chainId}`;
    }

    const bodySponsor = {
        method: 'pm_sponsorUserOperation',
        params: [userOp, ENTRY_POINT],
    };

    const rSponsor = await Axios.post(particlePaymasterUrl, bodySponsor);
    console.log('rSponsor', rSponsor.data);
    userOp.paymasterAndData = rSponsor.data.result.paymasterAndData;

    return deepHexlify(userOp);
}
