import { MESSAGE_32602_INVALID_PARAMS_LENGTH } from '../../../common/app-exception';
import { BUNDLING_MODE } from '../../../common/common-types';
import { Helper } from '../../../common/helper';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function bundler_setBundlingMode(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1 && ['manual', 'auto'].includes(body.params[0]), -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);

    const bundlingMode = body.params[0] === 'manual' ? BUNDLING_MODE.MANUAL : BUNDLING_MODE.AUTO;
    rpcService.aaService.setBundlingMode(bundlingMode);

    return 'ok';
}
