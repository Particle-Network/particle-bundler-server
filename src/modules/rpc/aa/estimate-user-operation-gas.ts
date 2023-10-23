import { JsonRpcProvider, getAddress, isAddress } from 'ethers';
import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { deepHexlify, getFeeDataFromParticle, isUserOpValid } from './utils';
import { isEmpty } from 'lodash';
import { BigNumber } from '../../../common/bignumber';
import {
    AppException,
    AppExceptionMessages,
    MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS,
    MESSAGE_32602_INVALID_PARAMS_LENGTH,
    MESSAGE_32602_INVALID_USEROP_TYPE,
} from '../../../common/app-exception';
import { EVM_CHAIN_ID_NOT_SUPPORT_1559 } from '../../../configs/bundler-config';
import { getBundlerConfig } from '../../../configs/bundler-common';
import { Logger } from '@nestjs/common';

export async function estimateUserOperationGas(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 2, -32602, MESSAGE_32602_INVALID_PARAMS_LENGTH);
    Helper.assertTrue(typeof body.params[0] === 'object', -32602, MESSAGE_32602_INVALID_USEROP_TYPE);
    Helper.assertTrue(typeof body.params[1] === 'string' && isAddress(body.params[1]), -32602, MESSAGE_32602_INVALID_ENTRY_POINT_ADDRESS);

    const userOp = body.params[0];
    const entryPoint = getAddress(body.params[1]);
    const bundlerConfig = getBundlerConfig(chainId);
    Helper.assertTrue(bundlerConfig.SUPPORTED_ENTRYPOINTS.includes(entryPoint), -32003);

    const provider = rpcService.getJsonRpcProvider(chainId);
    if (isEmpty(userOp.maxFeePerGas) || isEmpty(userOp.maxPriorityFeePerGas)) {
        const feeData = await getFeeDataFromParticle(chainId);
        userOp.maxFeePerGas = BigNumber.from(feeData.maxFeePerGas ?? 0).toHexString();
        userOp.maxPriorityFeePerGas = BigNumber.from(feeData.maxPriorityFeePerGas ?? 0).toHexString();

        if (EVM_CHAIN_ID_NOT_SUPPORT_1559.includes(chainId)) {
            userOp.maxFeePerGas = BigNumber.from(feeData.gasPrice).toHexString();
            userOp.maxPriorityFeePerGas = BigNumber.from(feeData.gasPrice).toHexString();
        }
    }

    userOp.preVerificationGas = BigNumber.from(1000000).toHexString();
    userOp.verificationGasLimit = BigNumber.from(1000000).toHexString();
    userOp.callGasLimit = BigNumber.from(10000000).toHexString();

    if (!userOp.paymasterAndData || userOp.paymasterAndData === '0x') {
        userOp.paymasterAndData = '0x';
    }

    if (!userOp.signature || userOp.signature === '0x') {
        // dummy signature
        userOp.signature =
            '0x3054659b5e29460a8f3ac9afc3d5fcbe4b76f92aed454b944e9b29e55d80fde807716530b739540e95cfa4880d69f710a9d45910f2951a227675dc1fb0fdf2c71c';
    }

    Helper.assertTrue(isUserOpValid(userOp), -32602, AppExceptionMessages.messageExtend(-32602, `Invalid userOp`));

    const { callGasLimit, initGas } = await estimateGasLimit(chainId, provider, entryPoint, userOp);

    Helper.assertTrue(
        BigNumber.from(userOp.maxFeePerGas).gt(0),
        -32602,
        AppExceptionMessages.messageExtend(-32602, `maxFeePerGas must be larger than 0 during gas estimation`),
    );

    try {
        const preVerificationGas = calcPreVerificationGas(userOp);
        const verificationGas = BigNumber.from(100000).add(initGas).toHexString();

        return deepHexlify({
            maxFeePerGas: userOp.maxFeePerGas,
            maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
            preVerificationGas,
            verificationGas,
            verificationGasLimit: verificationGas,
            callGasLimit: BigNumber.from(callGasLimit).toHexString(),
        });
    } catch (error) {
        Logger.error(error);

        if (error instanceof AppException) {
            throw error;
        }

        throw new AppException(-32005, error?.message);
    }
}

async function estimateGasLimit(chainId: number, provider: JsonRpcProvider, entryPoint: string, userOp: any) {
    let callGasLimit = 500000n;
    let initGas = 0n;

    try {
        if (userOp.initCode?.length > 2) {
            const factory = userOp.initCode.slice(0, 42);
            const factoryInitCode = `0x${userOp.initCode.slice(42)}`;

            initGas = await provider.estimateGas({
                from: entryPoint,
                to: factory,
                data: factoryInitCode,
            });
        } else {
            callGasLimit = await provider.estimateGas({
                from: entryPoint,
                to: userOp.sender,
                data: userOp.callData,
            });
        }
    } catch (error) {
        Logger.error('EstimateGasLimit Failed', error);
        // nothing
    }

    return { callGasLimit, initGas };
}
