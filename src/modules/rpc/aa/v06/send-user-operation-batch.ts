import { getAddress } from 'ethers';
import { JsonRPCRequestDto } from '../../dtos/json-rpc-request.dto';
import { RpcService } from '../../services/rpc.service';
import { Helper } from '../../../../common/helper';
import { isUserOpValidV06 } from '../utils';
import { isArray } from 'lodash';
import { beforeSendUserOperation } from './send-user-operation';

export async function sendUserOperationBatch(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(isArray(body.params[0]) && body.params[0].length >= 2, -32602, 'Invalid params: at least 2 userops');
    const userOps: any[] = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    for (const userOp of userOps) {
        Helper.assertTrue(isUserOpValidV06(userOp), -32602, 'Invalid userOp');
    }

    const resultItems = await Promise.all(
        userOps.map((userOp) => beforeSendUserOperation(rpcService, chainId, userOp, entryPoint, body.isAuth, body.skipCheck)),
    );
    for (const resultItem of resultItems) {
        Helper.assertTrue(!resultItem.userOperationEntity, -32611);
    }

    const userOpHashes = resultItems.map((i) => i.userOpHash);
    await rpcService.userOperationService.createBatchUserOperation(chainId, userOps, userOpHashes, entryPoint);

    return userOpHashes;
}
