import { Contract, JsonRpcProvider, getAddress, isAddress } from 'ethers';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import entryPointAbi from './entry-point-abi';
import { deepHexlify, isUserOpValid } from './utils';
import { isEmpty } from 'lodash';
import { BigNumber } from '../../../common/bignumber';
import { EVM_CHAIN_ID_NOT_SUPPORT_1559, SUPPORTED_ENTRYPOINTS } from '../../../configs/bundler-config';
import {
    AppException,
    AppExceptionMessages,
    MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS,
    MESSAGE_32602_INVALID_PARAMS_LENGTH,
    MESSAGE_32602_INVALID_USEROP_TYPE,
} from '../../../common/app-exception';

export async function estimateUserOperationGas(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 2, -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, MESSAGE_32602_INVALID_USEROP_TYPE);
    Helper.assertTrue(typeof body.params[1] === 'string' && isAddress(body.params[1]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);
    const entryPoint = getAddress(body.params[1]);
    Helper.assertTrue(SUPPORTED_ENTRYPOINTS.includes(entryPoint), -32003);

    const userOp = body.params[0];

    userOp.preVerificationGas = BigNumber.from(1000000).toHexString();
    userOp.verificationGasLimit = BigNumber.from(1000000).toHexString();
    userOp.callGasLimit = BigNumber.from(10000000).toHexString();

    const provider = rpcService.getJsonRpcProvider(chainId);
    if (isEmpty(userOp.maxFeePerGas) || isEmpty(userOp.maxPriorityFeePerGas)) {
        const feeData = await rpcService.getFeeData(chainId);
        userOp.maxFeePerGas = BigNumber.from(feeData.maxFeePerGas ?? 0).toHexString();
        userOp.maxPriorityFeePerGas = BigNumber.from(feeData.maxPriorityFeePerGas ?? 0).toHexString();

        if (EVM_CHAIN_ID_NOT_SUPPORT_1559.includes(chainId)) {
            userOp.maxFeePerGas = BigNumber.from(feeData.gasPrice).toHexString();
            userOp.maxPriorityFeePerGas = BigNumber.from(feeData.gasPrice).toHexString();
        }
    }

    Helper.assertTrue(
        BigNumber.from(userOp.maxFeePerGas).gt(0),
        -32602,
        AppExceptionMessages.messageExtend(-32602, `maxFeePerGas must be larger than 0 during gas estimation`),
    );

    if (isEmpty(userOp.signature) || userOp.signature === '0x') {
        // fake signature
        userOp.signature =
            '0x3054659b5e29460a8f3ac9afc3d5fcbe4b76f92aed454b944e9b29e55d80fde807716530b739540e95cfa4880d69f710a9d45910f2951a227675dc1fb0fdf2c71c';
    }

    Helper.assertTrue(isUserOpValid(userOp), -32602, AppExceptionMessages.messageExtend(-32602, `Invalid userOp`));
    const contractEntryPoint = new Contract(entryPoint, entryPointAbi, provider);

    try {
        const [errorResultSimulateHandleOp, estimateCallGasLimit] = await Promise.all([
            contractEntryPoint.simulateHandleOp.staticCall(userOp, '0x0000000000000000000000000000000000000000', '0x').catch((e) => e),
            estimateGasLimit(provider, entryPoint, userOp),
        ]);

        console.log('errorResultSimulateHandleOp', errorResultSimulateHandleOp);

        Helper.assertTrue(
            errorResultSimulateHandleOp?.revert?.name === 'ExecutionResult',
            -32606,
            AppExceptionMessages.messageExtend(-32606, errorResultSimulateHandleOp?.revert?.args?.at(-1)),
        );

        const preVerificationGas = calcPreVerificationGas(userOp);

        // error ExecutionResult(uint256 preOpGas, uint256 paid, uint48 validAfter, uint48 validUntil, bool targetSuccess, bytes targetResult);
        const args = errorResultSimulateHandleOp.revert.args;

        const verificationGas = BigNumber.from(args[0]).sub(BigNumber.from(userOp.preVerificationGas)).mul(3).div(2);
        const calculatedCallGasLimit = BigNumber.from(args[1]).div(userOp.maxFeePerGas).sub(args[0]).add(21000).add(50000);

        let callGasLimit = calculatedCallGasLimit.gt(9000) ? calculatedCallGasLimit : BigNumber.from(9000);
        callGasLimit = callGasLimit.gt(estimateCallGasLimit) ? callGasLimit : BigNumber.from(estimateCallGasLimit);

        return deepHexlify({
            maxFeePerGas: userOp.maxFeePerGas,
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
            preVerificationGas,
            verificationGas,
            verificationGasLimit: verificationGas,
            callGasLimit,
        });
    } catch (error) {
        if (error instanceof AppException) {
            throw error;
        }

        throw new AppException(-32005, error?.message);
    }
}

async function estimateGasLimit(provider: JsonRpcProvider, entryPoint: string, userOp: any) {
    let gasLimit = 500000n;

    try {
        gasLimit = await provider.estimateGas({
            from: entryPoint,
            to: userOp.sender,
            data: userOp.callData,
        });
    } catch (error) {
        // nothing
    }

    return gasLimit;
}
