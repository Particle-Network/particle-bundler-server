import {
    AbiCoder,
    BigNumberish,
    Contract,
    Interface,
    JsonRpcProvider,
    Wallet,
    getAddress,
    keccak256,
    resolveProperties,
    toBeHex,
    concat,
    toUtf8Bytes,
} from 'ethers';
import { calcPreVerificationGas } from '@account-abstraction/sdk';
import { arrayify } from '@ethersproject/bytes';
import { IContractAccount } from './interface-contract-account';
import { hexConcat } from '@ethersproject/bytes';
import { entryPointAbis } from '../../src/modules/rpc/aa/abis/entry-point-abis';
import { DUMMY_SIGNATURE } from '../../src/common/common-types';

const FACTORY_ADDRESS = '0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a';
const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

export class CoinbaseSmartAccount implements IContractAccount {
    private accountAddress: string;
    private simpleAccountContract: Contract;
    private readonly provider: JsonRpcProvider;
    private readonly epContract: Contract;
    private readonly factoryContract: Contract;
    private readonly entryPointAddress: string = ENTRY_POINT;

    public constructor(private readonly owner: Wallet) {
        console.log('CoinbaseSmartAccount Owner', this.owner.address);

        this.provider = owner.provider as JsonRpcProvider;
        this.epContract = new Contract(this.entryPointAddress, entryPointAbis.v06, owner);
        this.factoryContract = new Contract(FACTORY_ADDRESS, factoryAbi, owner);
    }

    public async getAccountAddress(index: number = 0): Promise<string> {
        if (this.accountAddress) {
            return this.accountAddress;
        }

        // TODO generate address in local (use eth_create2)
        const iface = new Interface(factoryAbi);
        const callData = iface.encodeFunctionData('getAddress', [this.getOwners(), 0]);
        const result = await this.provider.call({ to: await this.factoryContract.getAddress(), data: callData });

        this.accountAddress = getAddress(`0x${result.slice(-40)}`);
        return this.accountAddress;
    }

    public async createUnsignedUserOp(infos: TransactionDetailsForUserOp[], nonce?: any): Promise<any> {
        const { callData, callGasLimit } = await this.encodeUserOpCallDataAndGasLimit(infos);
        nonce = toBeHex(nonce ?? (await this.getNonce()));
        let initCode = '0x';
        if (BigInt(nonce) === 0n) {
            initCode = await this.createInitCode();
        }

        const initGas = toBeHex(500000);
        const verificationGasLimit = toBeHex(BigInt(await this.getVerificationGasLimit()) + BigInt(initGas));

        const partialUserOp: any = {
            sender: this.getAccountAddress(),
            nonce,
            initCode,
            callData,
            callGasLimit,
            verificationGasLimit,
            maxFeePerGas: '0x00',
            maxPriorityFeePerGas: '0x00',
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

        let callData: string;
        if (detailsForUserOp.length !== 1) {
            const targets = [];
            const datas = [];
            for (const detailForUserOp of detailsForUserOp) {
                targets.push(detailForUserOp.to);
                datas.push(detailForUserOp.data);
            }

            callData = await this.encodeExecuteBatch(targets, datas);
        } else {
            callData = await this.encodeExecute(detailsForUserOp[0].to, toBeHex(detailsForUserOp[0].value ?? 0), detailsForUserOp[0].data);
        }

        return {
            callData,
            callGasLimit: toBeHex(500000),
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
        const smartAccount = await this.getSimpleAccountContract();
        return (await smartAccount.execute.populateTransaction(target, value, data)).data;
    }

    public async encodeExecuteBatch(targets: string[], datas: string[]): Promise<string> {
        const simpleAccount = await this.getSimpleAccountContract();
        return (await simpleAccount.executeBatch.populateTransaction(targets, datas)).data;
    }

    public async createInitCode(index = 0): Promise<string> {
        const result = (await this.factoryContract.createAccount.populateTransaction(this.getOwners(), index)).data;

        return hexConcat([await this.factoryContract.getAddress(), result]);
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

        const accountAddress = await this.getAccountAddress();
        return await this.epContract.getNonce(accountAddress, 0);
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

    public async signUserOpHash(userOpHash: any) {
        return this.owner.signingKey.sign(arrayify(userOpHash)).serialized;
    }

    public async getUserOpHash(userOp: any) {
        return await this.epContract.getUserOpHash(userOp);
    }

    public getOwners(): string[] {
        return [AbiCoder.defaultAbiCoder().encode(['address'], [this.owner.address])];
    }
}

interface TransactionDetailsForUserOp {
    value?: any;
    to: string;
    data: string;
}

export const abi = [
    { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
    { type: 'fallback', stateMutability: 'payable' },
    { type: 'receive', stateMutability: 'payable' },
    {
        type: 'function',
        name: 'REPLAYABLE_NONCE_KEY',
        inputs: [],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'addOwnerAddress',
        inputs: [{ name: 'owner', type: 'address', internalType: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'addOwnerPublicKey',
        inputs: [
            { name: 'x', type: 'bytes32', internalType: 'bytes32' },
            { name: 'y', type: 'bytes32', internalType: 'bytes32' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'canSkipChainIdValidation',
        inputs: [{ name: 'functionSelector', type: 'bytes4', internalType: 'bytes4' }],
        outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
        stateMutability: 'pure',
    },
    {
        type: 'function',
        name: 'domainSeparator',
        inputs: [],
        outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'eip712Domain',
        inputs: [],
        outputs: [
            { name: 'fields', type: 'bytes1', internalType: 'bytes1' },
            { name: 'name', type: 'string', internalType: 'string' },
            { name: 'version', type: 'string', internalType: 'string' },
            { name: 'chainId', type: 'uint256', internalType: 'uint256' },
            { name: 'verifyingContract', type: 'address', internalType: 'address' },
            { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
            { name: 'extensions', type: 'uint256[]', internalType: 'uint256[]' },
        ],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'entryPoint',
        inputs: [],
        outputs: [{ name: '', type: 'address', internalType: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'execute',
        inputs: [
            { name: 'target', type: 'address', internalType: 'address' },
            { name: 'value', type: 'uint256', internalType: 'uint256' },
            { name: 'data', type: 'bytes', internalType: 'bytes' },
        ],
        outputs: [],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'executeBatch',
        inputs: [
            {
                name: 'calls',
                type: 'tuple[]',
                internalType: 'struct CoinbaseSmartWallet.Call[]',
                components: [
                    { name: 'target', type: 'address', internalType: 'address' },
                    { name: 'value', type: 'uint256', internalType: 'uint256' },
                    { name: 'data', type: 'bytes', internalType: 'bytes' },
                ],
            },
        ],
        outputs: [],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'executeWithoutChainIdValidation',
        inputs: [{ name: 'calls', type: 'bytes[]', internalType: 'bytes[]' }],
        outputs: [],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'getUserOpHashWithoutChainId',
        inputs: [
            {
                name: 'userOp',
                type: 'tuple',
                internalType: 'struct UserOperation',
                components: [
                    { name: 'sender', type: 'address', internalType: 'address' },
                    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
                    { name: 'initCode', type: 'bytes', internalType: 'bytes' },
                    { name: 'callData', type: 'bytes', internalType: 'bytes' },
                    { name: 'callGasLimit', type: 'uint256', internalType: 'uint256' },
                    { name: 'verificationGasLimit', type: 'uint256', internalType: 'uint256' },
                    { name: 'preVerificationGas', type: 'uint256', internalType: 'uint256' },
                    { name: 'maxFeePerGas', type: 'uint256', internalType: 'uint256' },
                    { name: 'maxPriorityFeePerGas', type: 'uint256', internalType: 'uint256' },
                    { name: 'paymasterAndData', type: 'bytes', internalType: 'bytes' },
                    { name: 'signature', type: 'bytes', internalType: 'bytes' },
                ],
            },
        ],
        outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'implementation',
        inputs: [],
        outputs: [{ name: '$', type: 'address', internalType: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'initialize',
        inputs: [{ name: 'owners', type: 'bytes[]', internalType: 'bytes[]' }],
        outputs: [],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'isOwnerAddress',
        inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
        outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'isOwnerBytes',
        inputs: [{ name: 'account', type: 'bytes', internalType: 'bytes' }],
        outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'isOwnerPublicKey',
        inputs: [
            { name: 'x', type: 'bytes32', internalType: 'bytes32' },
            { name: 'y', type: 'bytes32', internalType: 'bytes32' },
        ],
        outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'isValidSignature',
        inputs: [
            { name: 'hash', type: 'bytes32', internalType: 'bytes32' },
            { name: 'signature', type: 'bytes', internalType: 'bytes' },
        ],
        outputs: [{ name: 'result', type: 'bytes4', internalType: 'bytes4' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'nextOwnerIndex',
        inputs: [],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'ownerAtIndex',
        inputs: [{ name: 'index', type: 'uint256', internalType: 'uint256' }],
        outputs: [{ name: '', type: 'bytes', internalType: 'bytes' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'ownerCount',
        inputs: [],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'proxiableUUID',
        inputs: [],
        outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'removeLastOwner',
        inputs: [
            { name: 'index', type: 'uint256', internalType: 'uint256' },
            { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'removeOwnerAtIndex',
        inputs: [
            { name: 'index', type: 'uint256', internalType: 'uint256' },
            { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
        outputs: [],
        stateMutability: 'nonpayable',
    },
    {
        type: 'function',
        name: 'removedOwnersCount',
        inputs: [],
        outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'replaySafeHash',
        inputs: [{ name: 'hash', type: 'bytes32', internalType: 'bytes32' }],
        outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'upgradeToAndCall',
        inputs: [
            { name: 'newImplementation', type: 'address', internalType: 'address' },
            { name: 'data', type: 'bytes', internalType: 'bytes' },
        ],
        outputs: [],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'validateUserOp',
        inputs: [
            {
                name: 'userOp',
                type: 'tuple',
                internalType: 'struct UserOperation',
                components: [
                    { name: 'sender', type: 'address', internalType: 'address' },
                    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
                    { name: 'initCode', type: 'bytes', internalType: 'bytes' },
                    { name: 'callData', type: 'bytes', internalType: 'bytes' },
                    { name: 'callGasLimit', type: 'uint256', internalType: 'uint256' },
                    { name: 'verificationGasLimit', type: 'uint256', internalType: 'uint256' },
                    { name: 'preVerificationGas', type: 'uint256', internalType: 'uint256' },
                    { name: 'maxFeePerGas', type: 'uint256', internalType: 'uint256' },
                    { name: 'maxPriorityFeePerGas', type: 'uint256', internalType: 'uint256' },
                    { name: 'paymasterAndData', type: 'bytes', internalType: 'bytes' },
                    { name: 'signature', type: 'bytes', internalType: 'bytes' },
                ],
            },
            { name: 'userOpHash', type: 'bytes32', internalType: 'bytes32' },
            { name: 'missingAccountFunds', type: 'uint256', internalType: 'uint256' },
        ],
        outputs: [{ name: 'validationData', type: 'uint256', internalType: 'uint256' }],
        stateMutability: 'nonpayable',
    },
    {
        type: 'event',
        name: 'AddOwner',
        inputs: [
            { name: 'index', type: 'uint256', indexed: true, internalType: 'uint256' },
            { name: 'owner', type: 'bytes', indexed: false, internalType: 'bytes' },
        ],
        anonymous: false,
    },
    {
        type: 'event',
        name: 'RemoveOwner',
        inputs: [
            { name: 'index', type: 'uint256', indexed: true, internalType: 'uint256' },
            { name: 'owner', type: 'bytes', indexed: false, internalType: 'bytes' },
        ],
        anonymous: false,
    },
    {
        type: 'event',
        name: 'Upgraded',
        inputs: [{ name: 'implementation', type: 'address', indexed: true, internalType: 'address' }],
        anonymous: false,
    },
    { type: 'error', name: 'AlreadyOwner', inputs: [{ name: 'owner', type: 'bytes', internalType: 'bytes' }] },
    { type: 'error', name: 'Initialized', inputs: [] },
    { type: 'error', name: 'InvalidEthereumAddressOwner', inputs: [{ name: 'owner', type: 'bytes', internalType: 'bytes' }] },
    { type: 'error', name: 'InvalidNonceKey', inputs: [{ name: 'key', type: 'uint256', internalType: 'uint256' }] },
    { type: 'error', name: 'InvalidOwnerBytesLength', inputs: [{ name: 'owner', type: 'bytes', internalType: 'bytes' }] },
    { type: 'error', name: 'LastOwner', inputs: [] },
    { type: 'error', name: 'NoOwnerAtIndex', inputs: [{ name: 'index', type: 'uint256', internalType: 'uint256' }] },
    { type: 'error', name: 'NotLastOwner', inputs: [{ name: 'ownersRemaining', type: 'uint256', internalType: 'uint256' }] },
    { type: 'error', name: 'SelectorNotAllowed', inputs: [{ name: 'selector', type: 'bytes4', internalType: 'bytes4' }] },
    { type: 'error', name: 'Unauthorized', inputs: [] },
    { type: 'error', name: 'UnauthorizedCallContext', inputs: [] },
    { type: 'error', name: 'UpgradeFailed', inputs: [] },
    {
        type: 'error',
        name: 'WrongOwnerAtIndex',
        inputs: [
            { name: 'index', type: 'uint256', internalType: 'uint256' },
            { name: 'expectedOwner', type: 'bytes', internalType: 'bytes' },
            { name: 'actualOwner', type: 'bytes', internalType: 'bytes' },
        ],
    },
];

export const factoryAbi = [
    {
        type: 'constructor',
        inputs: [{ name: 'implementation_', type: 'address', internalType: 'address' }],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'createAccount',
        inputs: [
            { name: 'owners', type: 'bytes[]', internalType: 'bytes[]' },
            { name: 'nonce', type: 'uint256', internalType: 'uint256' },
        ],
        outputs: [{ name: 'account', type: 'address', internalType: 'contract CoinbaseSmartWallet' }],
        stateMutability: 'payable',
    },
    {
        type: 'function',
        name: 'getAddress',
        inputs: [
            { name: 'owners', type: 'bytes[]', internalType: 'bytes[]' },
            { name: 'nonce', type: 'uint256', internalType: 'uint256' },
        ],
        outputs: [{ name: '', type: 'address', internalType: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'implementation',
        inputs: [],
        outputs: [{ name: '', type: 'address', internalType: 'address' }],
        stateMutability: 'view',
    },
    {
        type: 'function',
        name: 'initCodeHash',
        inputs: [],
        outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
        stateMutability: 'view',
    },
    { type: 'error', name: 'OwnerRequired', inputs: [] },
];
