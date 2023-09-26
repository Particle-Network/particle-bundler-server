import { Contract, getAddress, isAddress, verifyMessage } from 'ethers';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import EntryPointAbi from './entry-point-abi';
import { BUNDLING_MODE, IS_DEVELOPMENT, keyEventSendUserOperation } from '../../../common/common-types';
import {
    AppException,
    AppExceptionMessages,
    MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS,
    MESSAGE_32602_INVALID_PARAMS_LENGTH,
    MESSAGE_32602_INVALID_USEROP_TYPE,
} from '../../../common/app-exception';
import { calcUserOpTotalGasLimit, isUserOpValid } from './utils';
import { BigNumber } from '../../../common/bignumber';
import { BUNDLER_CONFIG, SUPPORTED_ENTRYPOINTS } from '../../../configs/bundler-common';
import { arrayify } from '@ethersproject/bytes';

export async function sendUserOperation(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 2, -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);
    const userOp = body.params[0];
    let entryPointInput = getAddress(body.params[1]);

    Helper.assertTrue(typeof body.params[0] === 'object', -32602, MESSAGE_32602_INVALID_USEROP_TYPE);
    Helper.assertTrue(typeof body.params[1] === 'string' && isAddress(body.params[1]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);

    entryPointInput = getAddress(entryPointInput);
    Helper.assertTrue(SUPPORTED_ENTRYPOINTS.includes(entryPointInput), -32003);

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
    Helper.assertTrue(gasLimit.lt(BUNDLER_CONFIG.maxBundleGas), -32602, AppExceptionMessages.messageExtend(-32602, 'gasLimit is too large'));

    const provider = rpcService.getJsonRpcProvider(chainId);
    const contractEntryPoint = new Contract(entryPointInput, EntryPointAbi, provider);

    const errorResult = await contractEntryPoint.simulateValidation.staticCall(userOp).catch((e) => e);
    if (errorResult?.revert?.name === 'FailedOp') {
        console.error('errorResult', errorResult);

        throw new AppException(-32606, AppExceptionMessages.messageExtend(-32606, errorResult?.revert?.args.at(-1)));
    }

    const userOpHash = await contractEntryPoint.getUserOpHash(userOp);

    // recover signature
    if (!BigNumber.from(userOp.nonce).eq(0) && !IS_DEVELOPMENT) {
        let ownerAddress: any;
        if (userOp.signature !== '0x') {
            ownerAddress = verifyMessage(arrayify(userOpHash), userOp.signature);
        }

        // only simple account support these API, so the check is not mandatory here
        const abi = ['function owner() view returns (address)', 'function nonce() view returns (uint256)'];
        const contract = new Contract(userOp.sender, abi, provider);

        let owner: any;
        let nonce: any;
        try {
            [owner, nonce] = await Promise.all([contract.owner(), contract.nonce()]);
        } catch (error) {
            // nothing
        }

        if (!!owner && !!nonce && !!ownerAddress) {
            Helper.assertTrue(
                getAddress(ownerAddress) === getAddress(owner),
                -32602,
                AppExceptionMessages.messageExtend(-32602, 'AA24 signature error'),
            );

            Helper.assertTrue(
                BigNumber.from(userOp.nonce).gte(nonce),
                -32602,
                AppExceptionMessages.messageExtend(-32602, 'AA25 invalid account nonce'),
            );
        }
    }

    await rpcService.aaService.userOperationService.createOrUpdateUserOperation(chainId, userOp, userOpHash, entryPointInput);

    if (rpcService.aaService.getBundlingMode() === BUNDLING_MODE.AUTO) {
        rpcService.redisService.getClient().publish(keyEventSendUserOperation, JSON.stringify({ chainId }));
    }

    return userOpHash;
}
