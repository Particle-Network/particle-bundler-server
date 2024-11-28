import { RpcService } from '../services/rpc.service';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';

export async function suggestedFeeData(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    const feeData = await rpcService.chainService.getFeeDataIfCache(chainId);
    return feeData;
}
