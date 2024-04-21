// import { BigNumberish, Contract, Interface, JsonRpcProvider, Wallet, getAddress, resolveProperties } from 'ethers';
// import { hexConcat } from '../utils';
// import entryPointAbi from '../abis/entry-point-abi';
// import { BigNumber } from '../../../../common/bignumber';
// import { calcPreVerificationGas } from '@account-abstraction/sdk';
// import { arrayify } from '@ethersproject/bytes';
// import { IContractAccount } from '../interface-contract-account';

// export class SimpleSmartAccount implements IContractAccount {
//     private accountAddress: string;
//     private simpleAccountContract: Contract;
//     private readonly provider: JsonRpcProvider;
//     private readonly epContract: Contract;
//     private readonly simpleAccountFactoryContract: Contract;
//     private readonly entryPointAddress: string;

//     public constructor(private readonly owner: Wallet, factoryAddress: string, entryPointAddress: string) {
//         this.provider = owner.provider as JsonRpcProvider;
//         this.entryPointAddress = entryPointAddress;
//         this.epContract = new Contract(this.entryPointAddress, entryPointAbi, owner);
//         this.simpleAccountFactoryContract = new Contract(factoryAddress, factoryAbi, owner);
//     }

//     public async getAccountAddress(): Promise<string> {
//         if (this.accountAddress) {
//             return this.accountAddress;
//         }

//         // TODO generate address in local (use eth_create2)
//         const iface = new Interface(factoryAbi);
//         const callData = iface.encodeFunctionData('getAddress', [this.owner.address, 0]);
//         const result = await this.provider.call({ to: await this.simpleAccountFactoryContract.getAddress(), data: callData });

//         this.accountAddress = getAddress(`0x${result.slice(-40)}`);
//         return this.accountAddress;
//     }

//     public async createUnsignedUserOp(infos: TransactionDetailsForUserOp[], nonce?: any): Promise<any> {
//         const { callData, callGasLimit } = await this.encodeUserOpCallDataAndGasLimit(infos);
//         nonce = BigNumber.from(nonce ?? (await this.getNonce())).toHexString();
//         let initCode = '0x';
//         if (BigNumber.from(nonce).eq(0)) {
//             initCode = await this.createInitCode();
//         }

//         const initGas = BigNumber.from(500000).toHexString();
//         const verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit())
//             .add(initGas)
//             .toHexString();

//         const partialUserOp: any = {
//             sender: this.getAccountAddress(),
//             nonce,
//             initCode,
//             callData,
//             callGasLimit,
//             verificationGasLimit,
//             maxFeePerGas: '0x00',
//             maxPriorityFeePerGas: '0x00',
//             paymasterAndData: '0x',
//         };

//         return {
//             ...partialUserOp,
//             preVerificationGas: this.getPreVerificationGas(partialUserOp),
//             signature: '0x',
//         };
//     }

//     public async encodeUserOpCallDataAndGasLimit(detailsForUserOp: TransactionDetailsForUserOp[]) {
//         if (detailsForUserOp.length <= 0) {
//             throw new Error('userops is empty');
//         }

//         let callData: string;
//         if (detailsForUserOp.length !== 1) {
//             const targets = [];
//             const datas = [];
//             for (const detailForUserOp of detailsForUserOp) {
//                 targets.push(detailForUserOp.to);
//                 datas.push(detailForUserOp.data);
//             }

//             callData = await this.encodeExecuteBatch(targets, datas);
//         } else {
//             const value = BigNumber.from(detailsForUserOp[0].value ?? 0);
//             callData = await this.encodeExecute(detailsForUserOp[0].to, value.toHexString(), detailsForUserOp[0].data);
//         }

//         return {
//             callData,
//             callGasLimit: BigNumber.from(500000).toHexString(),
//         };
//     }

//     public async estimateCreationGas(initCode?: string): Promise<BigNumberish> {
//         if (initCode == null || initCode === '0x') {
//             return 0;
//         }

//         const deployerAddress = initCode.substring(0, 42);
//         const deployerCallData = '0x' + initCode.substring(42);
//         return await this.provider.estimateGas({ to: deployerAddress, data: deployerCallData });
//     }

//     public async encodeExecute(target: string, value: BigNumberish, data: string): Promise<string> {
//         const simpleAccount = await this.getSimpleAccountContract();
//         return (await simpleAccount.execute.populateTransaction(target, value, data)).data;
//     }

//     public async encodeExecuteBatch(targets: string[], datas: string[]): Promise<string> {
//         const simpleAccount = await this.getSimpleAccountContract();
//         return (await simpleAccount.executeBatch.populateTransaction(targets, datas)).data;
//     }

//     public async createInitCode(index = 0): Promise<string> {
//         const result = (await this.simpleAccountFactoryContract.createAccount.populateTransaction(this.owner.address, index)).data;

//         return hexConcat([await this.simpleAccountFactoryContract.getAddress(), result]);
//     }

//     public async getVerificationGasLimit(): Promise<BigNumberish> {
//         return 100000;
//     }

//     public async getPreVerificationGas(userOp: any): Promise<number> {
//         const p = await resolveProperties(userOp);

//         return calcPreVerificationGas(p);
//     }

//     public async getNonce(): Promise<number> {
//         const isAccountDeploied = await this.isAccountDeploied();
//         if (!isAccountDeploied) {
//             return 0;
//         }

//         const simpleAccountContract = await this.getSimpleAccountContract();
//         return await simpleAccountContract.getNonce();
//     }

//     public async isAccountDeploied(): Promise<boolean> {
//         const accountAddress = await this.getAccountAddress();
//         const code = await this.provider.getCode(accountAddress);
//         return code.length > 2;
//     }

//     public async getSimpleAccountContract(): Promise<Contract> {
//         if (this.simpleAccountContract) {
//             return this.simpleAccountContract;
//         }

//         const accountAddress = await this.getAccountAddress();
//         // fake simpleAccount address
//         this.simpleAccountContract = new Contract(accountAddress, abi, this.owner);
//         return this.simpleAccountContract;
//     }

//     public async signUserOpHash(userOp: any) {
//         return await this.owner.signMessage(arrayify(userOp));
//     }

//     public async getUserOpHash(userOp: any) {
//         return await this.epContract.getUserOpHash(userOp);
//     }
// }

// interface TransactionDetailsForUserOp {
//     value?: any;
//     to: string;
//     data: string;
// }

// export const abi = [
//     {
//         inputs: [
//             {
//                 internalType: 'contract IEntryPoint',
//                 name: 'anEntryPoint',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'nonpayable',
//         type: 'constructor',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             {
//                 indexed: false,
//                 internalType: 'address',
//                 name: 'previousAdmin',
//                 type: 'address',
//             },
//             {
//                 indexed: false,
//                 internalType: 'address',
//                 name: 'newAdmin',
//                 type: 'address',
//             },
//         ],
//         name: 'AdminChanged',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             {
//                 indexed: true,
//                 internalType: 'address',
//                 name: 'beacon',
//                 type: 'address',
//             },
//         ],
//         name: 'BeaconUpgraded',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             {
//                 indexed: false,
//                 internalType: 'uint8',
//                 name: 'version',
//                 type: 'uint8',
//             },
//         ],
//         name: 'Initialized',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             {
//                 indexed: true,
//                 internalType: 'contract IEntryPoint',
//                 name: 'entryPoint',
//                 type: 'address',
//             },
//             {
//                 indexed: true,
//                 internalType: 'address',
//                 name: 'owner',
//                 type: 'address',
//             },
//         ],
//         name: 'SimpleAccountInitialized',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             {
//                 indexed: true,
//                 internalType: 'address',
//                 name: 'implementation',
//                 type: 'address',
//             },
//         ],
//         name: 'Upgraded',
//         type: 'event',
//     },
//     {
//         inputs: [],
//         name: 'addDeposit',
//         outputs: [],
//         stateMutability: 'payable',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'entryPoint',
//         outputs: [
//             {
//                 internalType: 'contract IEntryPoint',
//                 name: '',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: 'dest',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: 'value',
//                 type: 'uint256',
//             },
//             {
//                 internalType: 'bytes',
//                 name: 'func',
//                 type: 'bytes',
//             },
//         ],
//         name: 'execute',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address[]',
//                 name: 'dest',
//                 type: 'address[]',
//             },
//             {
//                 internalType: 'bytes[]',
//                 name: 'func',
//                 type: 'bytes[]',
//             },
//         ],
//         name: 'executeBatch',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'getDeposit',
//         outputs: [
//             {
//                 internalType: 'uint256',
//                 name: '',
//                 type: 'uint256',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'getNonce',
//         outputs: [
//             {
//                 internalType: 'uint256',
//                 name: '',
//                 type: 'uint256',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: 'anOwner',
//                 type: 'address',
//             },
//         ],
//         name: 'initialize',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256[]',
//                 name: '',
//                 type: 'uint256[]',
//             },
//             {
//                 internalType: 'uint256[]',
//                 name: '',
//                 type: 'uint256[]',
//             },
//             {
//                 internalType: 'bytes',
//                 name: '',
//                 type: 'bytes',
//             },
//         ],
//         name: 'onERC1155BatchReceived',
//         outputs: [
//             {
//                 internalType: 'bytes4',
//                 name: '',
//                 type: 'bytes4',
//             },
//         ],
//         stateMutability: 'pure',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: '',
//                 type: 'uint256',
//             },
//             {
//                 internalType: 'uint256',
//                 name: '',
//                 type: 'uint256',
//             },
//             {
//                 internalType: 'bytes',
//                 name: '',
//                 type: 'bytes',
//             },
//         ],
//         name: 'onERC1155Received',
//         outputs: [
//             {
//                 internalType: 'bytes4',
//                 name: '',
//                 type: 'bytes4',
//             },
//         ],
//         stateMutability: 'pure',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: '',
//                 type: 'uint256',
//             },
//             {
//                 internalType: 'bytes',
//                 name: '',
//                 type: 'bytes',
//             },
//         ],
//         name: 'onERC721Received',
//         outputs: [
//             {
//                 internalType: 'bytes4',
//                 name: '',
//                 type: 'bytes4',
//             },
//         ],
//         stateMutability: 'pure',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'owner',
//         outputs: [
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'proxiableUUID',
//         outputs: [
//             {
//                 internalType: 'bytes32',
//                 name: '',
//                 type: 'bytes32',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'bytes4',
//                 name: 'interfaceId',
//                 type: 'bytes4',
//             },
//         ],
//         name: 'supportsInterface',
//         outputs: [
//             {
//                 internalType: 'bool',
//                 name: '',
//                 type: 'bool',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: '',
//                 type: 'uint256',
//             },
//             {
//                 internalType: 'bytes',
//                 name: '',
//                 type: 'bytes',
//             },
//             {
//                 internalType: 'bytes',
//                 name: '',
//                 type: 'bytes',
//             },
//         ],
//         name: 'tokensReceived',
//         outputs: [],
//         stateMutability: 'pure',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: 'newImplementation',
//                 type: 'address',
//             },
//         ],
//         name: 'upgradeTo',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: 'newImplementation',
//                 type: 'address',
//             },
//             {
//                 internalType: 'bytes',
//                 name: 'data',
//                 type: 'bytes',
//             },
//         ],
//         name: 'upgradeToAndCall',
//         outputs: [],
//         stateMutability: 'payable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 components: [
//                     {
//                         internalType: 'address',
//                         name: 'sender',
//                         type: 'address',
//                     },
//                     {
//                         internalType: 'uint256',
//                         name: 'nonce',
//                         type: 'uint256',
//                     },
//                     {
//                         internalType: 'bytes',
//                         name: 'initCode',
//                         type: 'bytes',
//                     },
//                     {
//                         internalType: 'bytes',
//                         name: 'callData',
//                         type: 'bytes',
//                     },
//                     {
//                         internalType: 'uint256',
//                         name: 'callGasLimit',
//                         type: 'uint256',
//                     },
//                     {
//                         internalType: 'uint256',
//                         name: 'verificationGasLimit',
//                         type: 'uint256',
//                     },
//                     {
//                         internalType: 'uint256',
//                         name: 'preVerificationGas',
//                         type: 'uint256',
//                     },
//                     {
//                         internalType: 'uint256',
//                         name: 'maxFeePerGas',
//                         type: 'uint256',
//                     },
//                     {
//                         internalType: 'uint256',
//                         name: 'maxPriorityFeePerGas',
//                         type: 'uint256',
//                     },
//                     {
//                         internalType: 'bytes',
//                         name: 'paymasterAndData',
//                         type: 'bytes',
//                     },
//                     {
//                         internalType: 'bytes',
//                         name: 'signature',
//                         type: 'bytes',
//                     },
//                 ],
//                 internalType: 'struct UserOperation',
//                 name: 'userOp',
//                 type: 'tuple',
//             },
//             {
//                 internalType: 'bytes32',
//                 name: 'userOpHash',
//                 type: 'bytes32',
//             },
//             {
//                 internalType: 'uint256',
//                 name: 'missingAccountFunds',
//                 type: 'uint256',
//             },
//         ],
//         name: 'validateUserOp',
//         outputs: [
//             {
//                 internalType: 'uint256',
//                 name: 'validationData',
//                 type: 'uint256',
//             },
//         ],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address payable',
//                 name: 'withdrawAddress',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: 'amount',
//                 type: 'uint256',
//             },
//         ],
//         name: 'withdrawDepositTo',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         stateMutability: 'payable',
//         type: 'receive',
//     },
// ];

// export const factoryAbi = [
//     {
//         inputs: [
//             {
//                 internalType: 'contract IEntryPoint',
//                 name: '_entryPoint',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'nonpayable',
//         type: 'constructor',
//     },
//     {
//         inputs: [],
//         name: 'accountImplementation',
//         outputs: [
//             {
//                 internalType: 'contract SimpleAccount',
//                 name: '',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: 'owner',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: 'salt',
//                 type: 'uint256',
//             },
//         ],
//         name: 'createAccount',
//         outputs: [
//             {
//                 internalType: 'contract SimpleAccount',
//                 name: 'ret',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 internalType: 'address',
//                 name: 'owner',
//                 type: 'address',
//             },
//             {
//                 internalType: 'uint256',
//                 name: 'salt',
//                 type: 'uint256',
//             },
//         ],
//         name: 'getAddress',
//         outputs: [
//             {
//                 internalType: 'address',
//                 name: '',
//                 type: 'address',
//             },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
// ];
