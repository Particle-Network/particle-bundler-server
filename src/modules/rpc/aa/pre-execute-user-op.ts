import { getAddress, isHexString } from 'ethers';
import { RpcService } from '../services/rpc.service';
import { deepHexlify, splitOriginNonce } from './utils';
import { entryPointAbis } from './abis/entry-point-abis';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { Helper } from '../../../common/helper';

export async function preExecuteUserOp(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, 'Invalid params: userop must be an object');

    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    try {
        await tryPreExecuteUserOp(rpcService, chainId, userOp, entryPoint, body.accountIsDeployed);
    } catch (error) {
        return {
            isSuccess: false,
            errMsg: error.message,
        };
    }
    return {
        isSuccess: true,
    };
}

export async function tryPreExecuteUserOp(
    rpcService: RpcService,
    chainId: number,
    userOp: any,
    entryPoint: string,
    accountIsDeployed: boolean = false,
): Promise<void> {
    const version = rpcService.getVersionByEntryPoint(entryPoint);
    const contractEntryPoint = rpcService.getSetCachedContract(entryPoint, entryPointAbis[version]);
    const signer = rpcService.signerService.getChainSigners(chainId)[0];

    const callTx = await contractEntryPoint.handleOps.populateTransaction([userOp], signer.address, { from: signer.address });
    const promises = [rpcService.chainService.staticCall(chainId, callTx, true)];
    const { nonceValue } = splitOriginNonce(userOp.nonce);

    // check account exists to replace check nonce??
    if (BigInt(nonceValue) >= 1n || accountIsDeployed) {
        // check account call is success because entry point will catch the error
        promises.push(
            rpcService.chainService.estimateGas(chainId, {
                from: entryPoint,
                to: userOp.sender,
                data: userOp.callData,
            }),
        );
    }

    try {
        const [rhandleOps] = await Promise.all(promises);

        if (!!rhandleOps?.error) {
            let errorMessage = '';
            if (!!rhandleOps.error?.data && isHexString(rhandleOps.error.data)) {
                const errorDescription: any = contractEntryPoint.interface.parseError(rhandleOps.error.data);
                errorMessage = `${errorDescription.name}: ${JSON.stringify(deepHexlify(errorDescription.args))}`;
            }

            throw new Error(errorMessage);
        }
    } catch (error) {
        const msg =
            error?.revert?.args.at(-1) ??
            (error?.info?.error?.code === 10001 ? 'Node RPC Error' : null) ??
            error?.shortMessage ??
            error?.message;
        throw new Error(msg);
    }
}
