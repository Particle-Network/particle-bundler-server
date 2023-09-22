import { BigNumberish, Contract, JsonRpcProvider, Wallet, resolveProperties } from 'ethers';
import { hexConcat } from './utils';
import entryPointAbi from './entry-point-abi';
import { BigNumber } from '../../../common/bignumber';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { arrayify } from '@ethersproject/bytes';
import { IContractAccount } from './interface-contract-account';

export class SimpleAccount implements IContractAccount {
    private accountAddress: string;
    private simpleAccountContract: Contract;
    private readonly provider: JsonRpcProvider;
    private readonly epContract: Contract;
    private readonly simpleAccountFactoryContract: Contract;
    private readonly entryPointAddress: string;

    public constructor(private readonly owner: Wallet, factoryAddress: string, entryPointAddress: string) {
        this.provider = owner.provider as JsonRpcProvider;
        this.entryPointAddress = entryPointAddress;
        this.epContract = new Contract(this.entryPointAddress, entryPointAbi, owner);
        this.simpleAccountFactoryContract = new Contract(factoryAddress, factoryAbi, owner);
    }

    public async getAccountAddress(): Promise<string> {
        if (this.accountAddress) {
            return this.accountAddress;
        }

        try {
            await this.epContract.getSenderAddress.staticCall(await this.createInitCode());
        } catch (e: any) {
            if (!e?.revert?.args) {
                throw e;
            }

            this.accountAddress = e.revert.args.at(-1);
        }

        return this.accountAddress;
    }

    public async createUnsignedUserOp(info: TransactionDetailsForUserOp): Promise<any> {
        const { callData, callGasLimit } = await this.encodeUserOpCallDataAndGasLimit(info);
        const nonce = info.nonce ?? (await this.getNonce());
        let initCode = '0x';
        if (BigNumber.from(nonce).eq(0)) {
            initCode = await this.createInitCode();
        }

        const initGas = await this.estimateCreationGas(initCode);
        const verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit()).add(initGas);

        let { maxFeePerGas, maxPriorityFeePerGas } = info;
        if (maxFeePerGas == null || maxPriorityFeePerGas == null) {
            const feeData = await this.provider.getFeeData();
            if (maxFeePerGas == null) {
                maxFeePerGas = feeData.maxFeePerGas ?? undefined;
            }
            if (maxPriorityFeePerGas == null) {
                maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? undefined;
            }
        }

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

    public async encodeUserOpCallDataAndGasLimit(detailsForUserOp: TransactionDetailsForUserOp) {
        const value = BigNumber.from(detailsForUserOp.value ?? 0);
        const callData = await this.encodeExecute(detailsForUserOp.to, value.toHexString(), detailsForUserOp.data);

        let callGasLimit = BigNumber.from(detailsForUserOp.gasLimit ?? 0);
        if (callGasLimit.eq(0)) {
            callGasLimit = BigNumber.from(
                await this.provider.estimateGas({
                    from: this.entryPointAddress,
                    to: this.getAccountAddress(),
                    data: callData,
                }),
            );
        }

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
        const simpleAccount = await this.getSimpleAccountContract();
        return (await simpleAccount.execute.populateTransaction(target, value, data)).data;
    }

    public async createInitCode(index: number = 0): Promise<string> {
        const result = (await this.simpleAccountFactoryContract.createAccount.populateTransaction(this.owner.address, index)).data;

        return hexConcat([await this.simpleAccountFactoryContract.getAddress(), result]);
    }

    public async getVerificationGasLimit(): Promise<BigNumberish> {
        return 100000;
    }

    public async getPreVerificationGas(userOp: any): Promise<number> {
        const p = await resolveProperties(userOp);

        return calcPreVerificationGas(p);
    }

    public async getNonce(): Promise<number> {
        const isAccountDeploied = await this.isAccountDeploied();
        if (!isAccountDeploied) {
            return 0;
        }

        const simpleAccountContract = await this.getSimpleAccountContract();
        return await simpleAccountContract.getNonce();
    }

    public async isAccountDeploied(): Promise<boolean> {
        const accountAddress = await this.getAccountAddress();
        const code = await this.provider.getCode(accountAddress);
        return code.length > 2;
    }

    public async getSimpleAccountContract(): Promise<Contract> {
        if (this.simpleAccountContract) {
            return this.simpleAccountContract;
        }

        const accountAddress = await this.getAccountAddress();
        // fake simpleAccount address
        this.simpleAccountContract = new Contract(accountAddress, abi, this.owner);
        return this.simpleAccountContract;
    }

    public async signUserOpHash(userOp: any) {
        return await this.owner.signMessage(arrayify(userOp));
    }

    public async getUserOpHash(userOp: any) {
        return await this.epContract.getUserOpHash(userOp);
    }
}

interface TransactionDetailsForUserOp {
    gasLimit?: any;
    value?: any;
    to: string;
    data: string;
    maxPriorityFeePerGas?: any;
    maxFeePerGas?: any;
    nonce?: any;
}

export const abi = [
    {
        inputs: [
            {
                internalType: 'contract IEntryPoint',
                name: 'anEntryPoint',
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
                indexed: false,
                internalType: 'address',
                name: 'previousAdmin',
                type: 'address',
            },
            {
                indexed: false,
                internalType: 'address',
                name: 'newAdmin',
                type: 'address',
            },
        ],
        name: 'AdminChanged',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'beacon',
                type: 'address',
            },
        ],
        name: 'BeaconUpgraded',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: false,
                internalType: 'uint8',
                name: 'version',
                type: 'uint8',
            },
        ],
        name: 'Initialized',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'contract IEntryPoint',
                name: 'entryPoint',
                type: 'address',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'owner',
                type: 'address',
            },
        ],
        name: 'SimpleAccountInitialized',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'implementation',
                type: 'address',
            },
        ],
        name: 'Upgraded',
        type: 'event',
    },
    {
        inputs: [],
        name: 'addDeposit',
        outputs: [],
        stateMutability: 'payable',
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
                name: 'dest',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: 'value',
                type: 'uint256',
            },
            {
                internalType: 'bytes',
                name: 'func',
                type: 'bytes',
            },
        ],
        name: 'execute',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address[]',
                name: 'dest',
                type: 'address[]',
            },
            {
                internalType: 'bytes[]',
                name: 'func',
                type: 'bytes[]',
            },
        ],
        name: 'executeBatch',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'getDeposit',
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
                internalType: 'address',
                name: 'anOwner',
                type: 'address',
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
        inputs: [],
        name: 'owner',
        outputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'proxiableUUID',
        outputs: [
            {
                internalType: 'bytes32',
                name: '',
                type: 'bytes32',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'bytes4',
                name: 'interfaceId',
                type: 'bytes4',
            },
        ],
        name: 'supportsInterface',
        outputs: [
            {
                internalType: 'bool',
                name: '',
                type: 'bool',
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
            {
                internalType: 'bytes',
                name: '',
                type: 'bytes',
            },
        ],
        name: 'tokensReceived',
        outputs: [],
        stateMutability: 'pure',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: 'newImplementation',
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
                internalType: 'address',
                name: 'newImplementation',
                type: 'address',
            },
            {
                internalType: 'bytes',
                name: 'data',
                type: 'bytes',
            },
        ],
        name: 'upgradeToAndCall',
        outputs: [],
        stateMutability: 'payable',
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
        inputs: [
            {
                internalType: 'address payable',
                name: 'withdrawAddress',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: 'amount',
                type: 'uint256',
            },
        ],
        name: 'withdrawDepositTo',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        stateMutability: 'payable',
        type: 'receive',
    },
];

export const factoryAbi = [
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
        inputs: [],
        name: 'accountImplementation',
        outputs: [
            {
                internalType: 'contract SimpleAccount',
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
                name: 'owner',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: 'salt',
                type: 'uint256',
            },
        ],
        name: 'createAccount',
        outputs: [
            {
                internalType: 'contract SimpleAccount',
                name: 'ret',
                type: 'address',
            },
        ],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            {
                internalType: 'address',
                name: 'owner',
                type: 'address',
            },
            {
                internalType: 'uint256',
                name: 'salt',
                type: 'uint256',
            },
        ],
        name: 'getAddress',
        outputs: [
            {
                internalType: 'address',
                name: '',
                type: 'address',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
];
