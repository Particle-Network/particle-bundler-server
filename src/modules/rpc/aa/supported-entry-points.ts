import { ENTRY_POINT_ADDRESS_V06, ENTRY_POINT_ADDRESS_V07 } from '../../../configs/bundler-common';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';

export async function supportedEntryPoints(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    return [ENTRY_POINT_ADDRESS_V06, ENTRY_POINT_ADDRESS_V07];
}
