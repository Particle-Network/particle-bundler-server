import { getAddress, isAddress } from 'ethers';
import { MESSAGE_32602_INVALID_PARAMS_LENGTH, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS } from '../../../common/app-exception';
import { Helper } from '../../../common/helper';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { getBundlerConfig } from '../../../configs/bundler-common';

export async function bundler_dumpMempool(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);
    Helper.assertTrue(typeof body.params[0] === 'string' && isAddress(body.params[0]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);

    const entryPoint = getAddress(body.params[0]);
    const bundlerConfig = getBundlerConfig(chainId);
    Helper.assertTrue(bundlerConfig.SUPPORTED_ENTRYPOINTS.includes(entryPoint), -32003);

    const localUserOperations = await rpcService.aaService.userOperationService.getLocalUserOperationsByChainIdAndSortByCreatedAt(
        chainId,
        entryPoint,
    );

    return localUserOperations.map((u) => u.origin);
}
