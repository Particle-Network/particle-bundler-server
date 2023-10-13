import { Contract, getAddress, isAddress } from 'ethers';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import EntryPointAbi from './entry-point-abi';
import { BUNDLING_MODE, keyEventSendUserOperation } from '../../../common/common-types';
import {
    AppException,
    AppExceptionMessages,
    MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS,
    MESSAGE_32602_INVALID_PARAMS_LENGTH,
    MESSAGE_32602_INVALID_USEROP_TYPE,
} from '../../../common/app-exception';
import { calcUserOpTotalGasLimit, isUserOpValid } from './utils';
import { BigNumber } from '../../../common/bignumber';
import { getBundlerConfig } from '../../../configs/bundler-common';
import entryPointAbi from './entry-point-abi';

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 2, -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);
    const userOp = body.params[0];
    let entryPointInput = getAddress(body.params[1]);

    Helper.assertTrue(typeof body.params[0] === 'object', -32602, MESSAGE_32602_INVALID_USEROP_TYPE);
    Helper.assertTrue(typeof body.params[1] === 'string' && isAddress(body.params[1]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);

    entryPointInput = getAddress(entryPointInput);
    const bundlerConfig = getBundlerConfig(chainId);
    Helper.assertTrue(bundlerConfig.SUPPORTED_ENTRYPOINTS.includes(entryPointInput), -32003);

    Helper.assertTrue(isUserOpValid(userOp), -32602, AppExceptionMessages.messageExtend(-32602, `Invalid userOp`));
    Helper.assertTrue(
        BigNumber.from(userOp.verificationGasLimit).gte(10000),
        -32602,
        AppExceptionMessages.messageExtend(-32602, `verificationGasLimit must be at least 10000`),
    );

    if (
        BigNumber.from(userOp.preVerificationGas).eq(0) ||
        BigNumber.from(userOp.verificationGasLimit).eq(0) ||
        BigNumber.from(userOp.callGasLimit).eq(0)
    ) {
        throw new AppException(-32602, AppExceptionMessages.messageExtend(-32602, 'Gas limits must be larger than 0'));
    }

    const gasLimit = calcUserOpTotalGasLimit(userOp);
    Helper.assertTrue(gasLimit.lt(bundlerConfig.MAX_BUNDLE_GAS), -32602, AppExceptionMessages.messageExtend(-32602, 'gasLimit is too large'));

    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPointInput, EntryPointAbi, provider);

    const errorResult = await contractEntryPoint.simulateValidation.staticCall(userOp).catch((e) => e);
    if (errorResult?.revert?.name === 'FailedOp') {
        console.error('errorResult', errorResult);

        throw new AppException(-32606, AppExceptionMessages.messageExtend(-32606, errorResult?.revert?.args.at(-1)));
    }

    const userOpHash = await contractEntryPoint.getUserOpHash(userOp);

    if (!BigNumber.from(userOp.nonce).eq(0)) {
        const epContract = new Contract(entryPointInput, entryPointAbi, provider);
        let [remoteNonce, localMaxNonce] = await Promise.all([
            epContract.getNonce(userOp.sender, 0),
            rpcService.aaService.userOperationService.getSuccessUserOperationNonce(chainId, getAddress(userOp.sender)),
        ]);

        localMaxNonce = BigNumber.from(localMaxNonce ?? '-1').add(1).toHexString();
        const targetNonce = BigNumber.from(localMaxNonce).gt(remoteNonce) ? localMaxNonce : remoteNonce;

        Helper.assertTrue(
            BigNumber.from(userOp.nonce).gte(targetNonce),
            -32602,
            AppExceptionMessages.messageExtend(-32602, 'AA25 invalid account nonce'),
        );
    }

    await rpcService.aaService.userOperationService.createOrUpdateUserOperation(
        chainId,
        userOp,
        userOpHash,
        entryPointInput,
    );

    if (rpcService.aaService.getBundlingMode() === BUNDLING_MODE.AUTO) {
        rpcService.redisService.getClient().publish(keyEventSendUserOperation, JSON.stringify({ chainId }));
    }

    return userOpHash;
}
