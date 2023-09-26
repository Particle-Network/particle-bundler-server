import { keyEventSendUserOperation } from '../../../common/common-types';
import { RPC_CONFIG } from '../../../configs/bundler-common';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function bundler_sendBundleNow(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Object.values(RPC_CONFIG).forEach((rpcConfig: any) => {
        rpcService.redisService.getClient().publish(keyEventSendUserOperation, JSON.stringify({ chainId: rpcConfig.chainId }));
    });

    return 'ok';
}
