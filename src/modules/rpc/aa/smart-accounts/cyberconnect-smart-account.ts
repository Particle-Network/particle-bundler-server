import { BigNumberish, Contract, JsonRpcProvider, Wallet, concat, getAddress, resolveProperties } from 'ethers';
import { getFeeDataFromParticle } from '../utils';
import entryPointAbi from '../entry-point-abi';
import { BigNumber } from '../../../../common/bignumber';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { arrayify } from '@ethersproject/bytes';
import { IContractAccount } from '../interface-contract-account';
import { EVM_CHAIN_ID } from '../../../../configs/bundler-common';
import { CyberFactory } from '@cyberlab/cyber-account';

const SUPPORTED_MAINNET = [EVM_CHAIN_ID.POLYGON_MAINNET];
const SUPPORTED_TESTNET = [EVM_CHAIN_ID.BNB_TESTNET, EVM_CHAIN_ID.LINEA_TESTNET, EVM_CHAIN_ID.POLYGON_TESTNET];

export class CyberConnectSmartAccount implements IContractAccount {
    private accountAddress: string;
    private accountContract: Contract;
    private readonly provider: JsonRpcProvider;
    private readonly epContract: Contract;
    private readonly factory: CyberFactory;
    private readonly entryPointAddress: string;

    public constructor(private readonly owner: Wallet, private readonly chainId: number, entryPointAddress: string) {
        this.provider = owner.provider as JsonRpcProvider;
        this.entryPointAddress = entryPointAddress;
        this.epContract = new Contract(this.entryPointAddress, entryPointAbi, owner);
        if (!SUPPORTED_MAINNET.concat(SUPPORTED_TESTNET).includes(this.chainId)) {
            throw new Error('Not support chainId');
        }

        this.factory = new CyberFactory({
            ownerAddress: owner.address as any,
            chain: {
                id: this.chainId,
                testnet: SUPPORTED_TESTNET.includes(this.chainId),
            },
        });

        this.accountAddress = getAddress(this.factory.calculateContractAccountAddress());
    }

    public async createUnsignedUserOp(infos: TransactionDetailsForUserOp[], nonce?: any): Promise<any> {
        let { callData, callGasLimit } = await this.encodeUserOpCallDataAndGasLimit(infos);
        const isAccountDeploied = await this.isAccountDeploied();
        nonce = nonce ?? (await this.getNonce(isAccountDeploied));
        let initCode = '0x';
        if (BigNumber.from(nonce).eq(0) && !isAccountDeploied) {
            initCode = this.createInitCode();
            if (BigNumber.from(callGasLimit).lt(30000)) {
                callGasLimit = BigNumber.from(callGasLimit).add(30000).toHexString();
            }
        }

        const initGas = await this.estimateCreationGas(initCode);
        const verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit()).add(initGas);

        const feeData = await getFeeDataFromParticle(this.chainId);
        const maxFeePerGas = feeData.maxFeePerGas ?? undefined;
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? undefined;

        const partialUserOp: any = {
            sender: this.getAccountAddress(),
            nonce,
            initCode,
            callData,
            callGasLimit,
            verificationGasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
            paymasterAndData: '0x',
        };

        return {
            ...partialUserOp,
            preVerificationGas: this.getPreVerificationGas(partialUserOp),
            signature: '0x',
        };
    }

    public async encodeUserOpCallDataAndGasLimit(detailsForUserOp: TransactionDetailsForUserOp[]) {
        if (detailsForUserOp.length <= 0) {
            throw new Error('userops is empty');
        }

        if (detailsForUserOp.length > 1) {
            throw new Error('Not support batch userops');
        }

        const value = BigNumber.from(detailsForUserOp[0].value ?? 0);
        const callData = await this.encodeExecute(detailsForUserOp[0].to, value.toHexString(), detailsForUserOp[0].data);

        const callGasLimit = BigNumber.from(
            await this.provider.estimateGas({
                from: this.entryPointAddress,
                to: this.getAccountAddress(),
                data: callData,
            }),
        );

        return {
            callData,
            callGasLimit: callGasLimit.toHexString(),
        };
    }

    public async estimateCreationGas(initCode?: string): Promise<BigNumberish> {
        if (initCode == null || initCode === '0x') {
            return 0;
        }

        const deployerAddress = initCode.substring(0, 42);
        const deployerCallData = '0x' + initCode.substring(42);
        return await this.provider.estimateGas({ to: deployerAddress, data: deployerCallData });
    }

    public async encodeExecute(target: string, value: BigNumberish, data: string): Promise<string> {
        const smartAccount = this.getAccountContract();
        return (await smartAccount.execute.populateTransaction(target, value, data, 0)).data;
    }

    public createInitCode(): string {
        return concat([this.factory.contractAddresses.factory, this.factory.getFactoryInitCode()]);
    }

    public async getVerificationGasLimit(): Promise<BigNumberish> {
        return 100000;
    }

    public async getPreVerificationGas(userOp: any): Promise<number> {
        const p = await resolveProperties(userOp);

        return calcPreVerificationGas(p);
    }

    public async getNonce(isAccountDeploied: boolean): Promise<number> {
        if (!isAccountDeploied) {
            return 0;
        }

        return await this.epContract.getNonce(this.getAccountAddress(), 0);
    }

    public async isAccountDeploied(): Promise<boolean> {
        const accountAddress = this.getAccountAddress();
        const code = await this.provider.getCode(accountAddress);
        return code.length > 2;
    }

    public getAccountContract(): Contract {
        if (this.accountContract) {
            return this.accountContract;
        }

        const accountAddress = this.getAccountAddress();
        // fake account address
        this.accountContract = new Contract(accountAddress, abi, this.owner);
        return this.accountContract;
    }

    public async signUserOpHash(userOp: any) {
        return concat([CyberFactory.validationModes.sudo, await this.owner.signMessage(arrayify(userOp))]);
    }

    public async getUserOpHash(userOp: any) {
        return await this.epContract.getUserOpHash(userOp);
    }

    public getAccountAddress(): string {
        return this.accountAddress;
    }
}

interface TransactionDetailsForUserOp {
    value?: any;
    to: string;
    data: string;
}

export const abi = [
    {
        inputs: [
            {
                internalType: 'contract IEntryPoint',
                name: '_entryPoint',
                type: 'address',
            },
        ],
        stateMutability: 'nonpayable',
        type: 'constructor',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'oldValidator',
                type: 'address',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'newValidator',
                type: 'address',
            },
        ],
        name: 'DefaultValidatorChanged',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'bytes4',
                name: 'selector',
                type: 'bytes4',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'executor',
                type: 'address',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'validator',
                type: 'address',
            },
        ],
        name: 'ExecutionChanged',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'newImplementation',
                type: 'address',
            },
        ],
        name: 'Upgraded',
        type: 'event',
    },
    {
        stateMutability: 'payable',
        type: 'fallback',
    },
    {
        inputs: [
            {
                internalType: 'bytes4',
                name: '_disableFlag',
                type: 'bytes4',
            },
        ],
        name: 'disableMode',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'entryPoint',
        outputs: [
            {
                internalType: 'contract IEntryPoint',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: 'to',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: 'value',
                type: 'uint256',
            },
            {
                internalType: 'bytes',
                name: 'data',
                type: 'bytes',
            },
            {
                internalType: 'enum Operation',
                name: 'operation',
                type: 'uint8',
            },
        ],
        name: 'execute',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getDefaultValidator',
        outputs: [
            {
                internalType: 'contract IKernelValidator',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getDisabledMode',
        outputs: [
            {
                internalType: 'bytes4',
                name: '',
                type: 'bytes4',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'bytes4',
                name: '_selector',
                type: 'bytes4',
            },
        ],
        name: 'getExecution',
        outputs: [
            {
                components: [
                    {
                        internalType: 'uint48',
                        name: 'validUntil',
                        type: 'uint48',
                    },
                    {
                        internalType: 'uint48',
                        name: 'validAfter',
                        type: 'uint48',
                    },
                    {
                        internalType: 'address',
                        name: 'executor',
                        type: 'address',
                    },
                    {
                        internalType: 'contract IKernelValidator',
                        name: 'validator',
                        type: 'address',
                    },
                ],
                internalType: 'struct ExecutionDetail',
                name: '',
                type: 'tuple',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getLastDisabledTime',
        outputs: [
            {
                internalType: 'uint48',
                name: '',
                type: 'uint48',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'uint192',
                name: 'key',
                type: 'uint192',
            },
        ],
        name: 'getNonce',
        outputs: [
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getNonce',
        outputs: [
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'contract IKernelValidator',
                name: '_defaultValidator',
                type: 'address',
            },
            {
                internalType: 'bytes',
                name: '_data',
                type: 'bytes',
            },
        ],
        name: 'initialize',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'bytes32',
                name: 'hash',
                type: 'bytes32',
            },
            {
                internalType: 'bytes',
                name: 'signature',
                type: 'bytes',
            },
        ],
        name: 'isValidSignature',
        outputs: [
            {
                internalType: 'bytes4',
                name: '',
                type: 'bytes4',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'name',
        outputs: [
            {
                internalType: 'string',
                name: '',
                type: 'string',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
            {
                internalType: 'uint256[]',
                name: '',
                type: 'uint256[]',
            },
            {
                internalType: 'uint256[]',
                name: '',
                type: 'uint256[]',
            },
            {
                internalType: 'bytes',
                name: '',
                type: 'bytes',
            },
        ],
        name: 'onERC1155BatchReceived',
        outputs: [
            {
                internalType: 'bytes4',
                name: '',
                type: 'bytes4',
            },
        ],
        stateMutability: 'pure',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
            },
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
            },
            {
                internalType: 'bytes',
                name: '',
                type: 'bytes',
            },
        ],
        name: 'onERC1155Received',
        outputs: [
            {
                internalType: 'bytes4',
                name: '',
                type: 'bytes4',
            },
        ],
        stateMutability: 'pure',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
            },
            {
                internalType: 'bytes',
                name: '',
                type: 'bytes',
            },
        ],
        name: 'onERC721Received',
        outputs: [
            {
                internalType: 'bytes4',
                name: '',
                type: 'bytes4',
            },
        ],
        stateMutability: 'pure',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'contract IKernelValidator',
                name: '_defaultValidator',
                type: 'address',
            },
            {
                internalType: 'bytes',
                name: '_data',
                type: 'bytes',
            },
        ],
        name: 'setDefaultValidator',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'bytes4',
                name: '_selector',
                type: 'bytes4',
            },
            {
                internalType: 'address',
                name: '_executor',
                type: 'address',
            },
            {
                internalType: 'contract IKernelValidator',
                name: '_validator',
                type: 'address',
            },
            {
                internalType: 'uint48',
                name: '_validUntil',
                type: 'uint48',
            },
            {
                internalType: 'uint48',
                name: '_validAfter',
                type: 'uint48',
            },
            {
                internalType: 'bytes',
                name: '_enableData',
                type: 'bytes',
            },
        ],
        name: 'setExecution',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: '_newImplementation',
                type: 'address',
            },
        ],
        name: 'upgradeTo',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            {
                components: [
                    {
                        internalType: 'address',
                        name: 'sender',
                        type: 'address',
                    },
                    {
                        internalType: 'uint256',
                        name: 'nonce',
                        type: 'uint256',
                    },
                    {
                        internalType: 'bytes',
                        name: 'initCode',
                        type: 'bytes',
                    },
                    {
                        internalType: 'bytes',
                        name: 'callData',
                        type: 'bytes',
                    },
                    {
                        internalType: 'uint256',
                        name: 'callGasLimit',
                        type: 'uint256',
                    },
                    {
                        internalType: 'uint256',
                        name: 'verificationGasLimit',
                        type: 'uint256',
                    },
                    {
                        internalType: 'uint256',
                        name: 'preVerificationGas',
                        type: 'uint256',
                    },
                    {
                        internalType: 'uint256',
                        name: 'maxFeePerGas',
                        type: 'uint256',
                    },
                    {
                        internalType: 'uint256',
                        name: 'maxPriorityFeePerGas',
                        type: 'uint256',
                    },
                    {
                        internalType: 'bytes',
                        name: 'paymasterAndData',
                        type: 'bytes',
                    },
                    {
                        internalType: 'bytes',
                        name: 'signature',
                        type: 'bytes',
                    },
                ],
                internalType: 'struct UserOperation',
                name: 'userOp',
                type: 'tuple',
            },
            {
                internalType: 'bytes32',
                name: 'userOpHash',
                type: 'bytes32',
            },
            {
                internalType: 'uint256',
                name: 'missingAccountFunds',
                type: 'uint256',
            },
        ],
        name: 'validateUserOp',
        outputs: [
            {
                internalType: 'uint256',
                name: 'validationData',
                type: 'uint256',
            },
        ],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'version',
        outputs: [
            {
                internalType: 'string',
                name: '',
                type: 'string',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        stateMutability: 'payable',
        type: 'receive',
    },
];
