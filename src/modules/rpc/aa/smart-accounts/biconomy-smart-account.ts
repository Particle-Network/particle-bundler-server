// import { BigNumberish, Contract, JsonRpcProvider, Wallet, resolveProperties } from 'ethers';
// import { getFeeDataFromParticle, hexConcat } from '../utils';
// import entryPointAbi from '../abis/entry-point-abi';
// import { BigNumber } from '../../../../common/bignumber';
// import { calcPreVerificationGas } from '@account-abstraction/sdk';
// import { arrayify } from '@ethersproject/bytes';
// import { IContractAccount } from '../interface-contract-account';

// export class BiconomySmartAccount implements IContractAccount {
//     private accountAddress: string;
//     private smartAccountContract: Contract;
//     private readonly provider: JsonRpcProvider;
//     private readonly epContract: Contract;
//     private readonly smartAccountFactoryContract: Contract;
//     private readonly entryPointAddress: string;

//     public constructor(private readonly owner: Wallet, factoryAddress: string, entryPointAddress: string) {
//         this.provider = owner.provider as JsonRpcProvider;
//         this.entryPointAddress = entryPointAddress;
//         this.epContract = new Contract(this.entryPointAddress, entryPointAbi, owner);
//         this.smartAccountFactoryContract = new Contract(factoryAddress, smartAccountFactoryABI, owner);
//     }

//     public async getAccountAddress(): Promise<string> {
//         if (this.accountAddress) {
//             return this.accountAddress;
//         }

//         this.accountAddress = await this.smartAccountFactoryContract.getAddressForCounterFactualAccount(this.owner.address, 0);

//         return this.accountAddress;
//     }

//     public async createUnsignedUserOp(infos: TransactionDetailsForUserOp[], nonce?: any): Promise<any> {
//         if (infos.length > 1) {
//             throw new Error('BiconomySmartAccount does not support batch transactions');
//         }

//         const info = infos[0];
//         const { callData, callGasLimit } = await this.encodeUserOpCallDataAndGasLimit(info);
//         nonce = info.nonce ?? (await this.getNonce());
//         let initCode = '0x';
//         if (BigNumber.from(nonce).eq(0)) {
//             initCode = await this.createInitCode();
//         }

//         const initGas = await this.estimateCreationGas(initCode);
//         const verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit()).add(initGas);

//         const network = await this.provider.getNetwork();
//         const feeData = await getFeeDataFromParticle(Number(network.chainId));
//         const maxFeePerGas = feeData.maxFeePerGas ?? undefined;
//         const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? undefined;

//         const partialUserOp: any = {
//             sender: this.getAccountAddress(),
//             nonce,
//             initCode,
//             callData,
//             callGasLimit,
//             verificationGasLimit,
//             maxFeePerGas,
//             maxPriorityFeePerGas,
//             paymasterAndData: '0x',
//         };

//         return {
//             ...partialUserOp,
//             preVerificationGas: this.getPreVerificationGas(partialUserOp),
//             signature: '0x',
//         };
//     }

//     public async encodeUserOpCallDataAndGasLimit(detailsForUserOp: TransactionDetailsForUserOp) {
//         const value = BigNumber.from(detailsForUserOp.value ?? 0);
//         const callData = await this.encodeExecute(detailsForUserOp.to, value.toHexString(), detailsForUserOp.data);

//         let callGasLimit = BigNumber.from(detailsForUserOp.gasLimit ?? 0);
//         if (callGasLimit.eq(0)) {
//             callGasLimit = BigNumber.from(
//                 await this.provider.estimateGas({
//                     from: this.entryPointAddress,
//                     to: this.getAccountAddress(),
//                     data: callData,
//                 }),
//             );
//         }

//         return {
//             callData,
//             callGasLimit: callGasLimit.toHexString(),
//         };
//     }

//     public async estimateCreationGas(initCode?: string): Promise<BigNumberish> {
//         if (!initCode || initCode === '0x') {
//             return 0;
//         }

//         const deployerAddress = initCode.substring(0, 42);
//         const deployerCallData = '0x' + initCode.substring(42);
//         return await this.provider.estimateGas({ to: deployerAddress, data: deployerCallData });
//     }

//     public async encodeExecute(to: string, value: BigNumberish, data: string): Promise<string> {
//         const simpleAccount = await this.getAccountContract();
//         return (await simpleAccount.executeCall.populateTransaction(to, value, data)).data;
//     }

//     public async createInitCode(index = 0): Promise<string> {
//         return hexConcat([
//             await this.smartAccountFactoryContract.getAddress(),
//             (await this.smartAccountFactoryContract.deployCounterFactualAccount.populateTransaction(this.owner.address, index)).data,
//         ]);
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

//         const accountContract = await this.getAccountContract();
//         return await accountContract.nonce();
//     }

//     public async isAccountDeploied(): Promise<boolean> {
//         const accountAddress = await this.getAccountAddress();
//         const code = await this.provider.getCode(accountAddress);
//         return code.length > 2;
//     }

//     public async getAccountContract(): Promise<Contract> {
//         if (this.smartAccountContract) {
//             return this.smartAccountContract;
//         }

//         const accountAddress = await this.getAccountAddress();

//         this.smartAccountContract = new Contract(accountAddress, smartAccountImplementationABI, this.owner);
//         return this.smartAccountContract;
//     }

//     public async signUserOpHash(userOp: any) {
//         return await this.owner.signMessage(arrayify(userOp));
//     }

//     public async getUserOpHash(userOp: any) {
//         return await this.epContract.getUserOpHash(userOp);
//     }
// }

// interface TransactionDetailsForUserOp {
//     gasLimit?: any;
//     value?: any;
//     to: string;
//     data: string;
//     maxPriorityFeePerGas?: any;
//     maxFeePerGas?: any;
//     nonce?: any;
// }

// export const smartAccountImplementationABI = [
//     {
//         inputs: [{ internalType: 'contract IEntryPoint', name: 'anEntryPoint', type: 'address' }],
//         stateMutability: 'nonpayable',
//         type: 'constructor',
//     },
//     { inputs: [{ internalType: 'address', name: 'smartAccount', type: 'address' }], name: 'AlreadyInitialized', type: 'error' },
//     { inputs: [], name: 'BaseImplementationCannotBeZero', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'caller', type: 'address' }], name: 'CallerIsNotAnEntryPoint', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'caller', type: 'address' }], name: 'CallerIsNotEntryPointOrOwner', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'caller', type: 'address' }], name: 'CallerIsNotOwner', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'caller', type: 'address' }], name: 'CallerIsNotSelf', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'uint256', name: 'targetTxGas', type: 'uint256' },
//             { internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
//             { internalType: 'bool', name: 'success', type: 'bool' },
//         ],
//         name: 'CanNotEstimateGas',
//         type: 'error',
//     },
//     { inputs: [], name: 'EntryPointCannotBeZero', type: 'error' },
//     { inputs: [], name: 'ExecutionFailed', type: 'error' },
//     { inputs: [], name: 'HandlerCannotBeZero', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'implementationAddress', type: 'address' }], name: 'InvalidImplementation', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'address', name: 'restoredSigner', type: 'address' },
//             { internalType: 'address', name: 'expectedSigner', type: 'address' },
//         ],
//         name: 'InvalidSignature',
//         type: 'error',
//     },
//     {
//         inputs: [
//             { internalType: 'uint256', name: 'nonceProvided', type: 'uint256' },
//             { internalType: 'uint256', name: 'nonceExpected', type: 'uint256' },
//         ],
//         name: 'InvalidUserOpNonceProvided',
//         type: 'error',
//     },
//     { inputs: [{ internalType: 'address', name: 'caller', type: 'address' }], name: 'MixedAuthFail', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'module', type: 'address' }], name: 'ModuleAlreadyEnabled', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'address', name: 'expectedModule', type: 'address' },
//             { internalType: 'address', name: 'returnedModule', type: 'address' },
//             { internalType: 'address', name: 'prevModule', type: 'address' },
//         ],
//         name: 'ModuleAndPrevModuleMismatch',
//         type: 'error',
//     },
//     { inputs: [{ internalType: 'address', name: 'module', type: 'address' }], name: 'ModuleCannotBeZeroOrSentinel', type: 'error' },
//     { inputs: [{ internalType: 'address', name: 'module', type: 'address' }], name: 'ModuleNotEnabled', type: 'error' },
//     { inputs: [], name: 'ModulesAlreadyInitialized', type: 'error' },
//     { inputs: [], name: 'ModulesSetupExecutionFailed', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'uint256', name: 'gasLeft', type: 'uint256' },
//             { internalType: 'uint256', name: 'gasRequired', type: 'uint256' },
//         ],
//         name: 'NotEnoughGasLeft',
//         type: 'error',
//     },
//     { inputs: [], name: 'OwnerCannotBeZero', type: 'error' },
//     { inputs: [], name: 'ReentrancyProtectionActivated', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'address', name: 'token', type: 'address' },
//             { internalType: 'address', name: 'dest', type: 'address' },
//             { internalType: 'uint256', name: 'amount', type: 'uint256' },
//         ],
//         name: 'TokenTransferFailed',
//         type: 'error',
//     },
//     { inputs: [], name: 'TransferToZeroAddressAttempt', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'uint256', name: 'destLength', type: 'uint256' },
//             { internalType: 'uint256', name: 'valueLength', type: 'uint256' },
//             { internalType: 'uint256', name: 'funcLength', type: 'uint256' },
//         ],
//         name: 'WrongBatchProvided',
//         type: 'error',
//     },
//     { inputs: [{ internalType: 'bytes', name: 'contractSignature', type: 'bytes' }], name: 'WrongContractSignature', type: 'error' },
//     {
//         inputs: [
//             { internalType: 'uint256', name: 'uintS', type: 'uint256' },
//             { internalType: 'uint256', name: 'contractSignatureLength', type: 'uint256' },
//             { internalType: 'uint256', name: 'signatureLength', type: 'uint256' },
//         ],
//         name: 'WrongContractSignatureFormat',
//         type: 'error',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'bytes32', name: 'txHash', type: 'bytes32' },
//             { indexed: true, internalType: 'uint256', name: 'payment', type: 'uint256' },
//         ],
//         name: 'AccountHandlePayment',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'previousHandler', type: 'address' },
//             { indexed: true, internalType: 'address', name: 'handler', type: 'address' },
//         ],
//         name: 'ChangedFallbackHandler',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [{ indexed: false, internalType: 'address', name: 'module', type: 'address' }],
//         name: 'DisabledModule',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: '_scw', type: 'address' },
//             { indexed: true, internalType: 'address', name: '_oldEOA', type: 'address' },
//             { indexed: true, internalType: 'address', name: '_newEOA', type: 'address' },
//         ],
//         name: 'EOAChanged',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [{ indexed: false, internalType: 'address', name: 'module', type: 'address' }],
//         name: 'EnabledModule',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'to', type: 'address' },
//             { indexed: true, internalType: 'uint256', name: 'value', type: 'uint256' },
//             { indexed: true, internalType: 'bytes', name: 'data', type: 'bytes' },
//             { indexed: false, internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//             { indexed: false, internalType: 'uint256', name: 'txGas', type: 'uint256' },
//         ],
//         name: 'ExecutionFailure',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [{ indexed: true, internalType: 'address', name: 'module', type: 'address' }],
//         name: 'ExecutionFromModuleFailure',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [{ indexed: true, internalType: 'address', name: 'module', type: 'address' }],
//         name: 'ExecutionFromModuleSuccess',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'to', type: 'address' },
//             { indexed: true, internalType: 'uint256', name: 'value', type: 'uint256' },
//             { indexed: true, internalType: 'bytes', name: 'data', type: 'bytes' },
//             { indexed: false, internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//             { indexed: false, internalType: 'uint256', name: 'txGas', type: 'uint256' },
//         ],
//         name: 'ExecutionSuccess',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'oldImplementation', type: 'address' },
//             { indexed: true, internalType: 'address', name: 'newImplementation', type: 'address' },
//         ],
//         name: 'ImplementationUpdated',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: false, internalType: 'address', name: 'module', type: 'address' },
//             { indexed: false, internalType: 'address', name: 'to', type: 'address' },
//             { indexed: false, internalType: 'uint256', name: 'value', type: 'uint256' },
//             { indexed: false, internalType: 'bytes', name: 'data', type: 'bytes' },
//             { indexed: false, internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//         ],
//         name: 'ModuleTransaction',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
//             { indexed: true, internalType: 'uint256', name: 'value', type: 'uint256' },
//         ],
//         name: 'SmartAccountReceivedNativeToken',
//         type: 'event',
//     },
//     { stateMutability: 'nonpayable', type: 'fallback' },
//     { inputs: [], name: 'VERSION', outputs: [{ internalType: 'string', name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
//     { inputs: [], name: 'addDeposit', outputs: [], stateMutability: 'payable', type: 'function' },
//     {
//         inputs: [
//             { internalType: 'bytes32', name: 'dataHash', type: 'bytes32' },
//             { internalType: 'bytes', name: 'signatures', type: 'bytes' },
//         ],
//         name: 'checkSignatures',
//         outputs: [],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'prevModule', type: 'address' },
//             { internalType: 'address', name: 'module', type: 'address' },
//         ],
//         name: 'disableModule',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'domainSeparator',
//         outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'address', name: 'module', type: 'address' }],
//         name: 'enableModule',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 components: [
//                     { internalType: 'address', name: 'to', type: 'address' },
//                     { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//                     { internalType: 'uint256', name: 'value', type: 'uint256' },
//                     { internalType: 'bytes', name: 'data', type: 'bytes' },
//                     { internalType: 'uint256', name: 'targetTxGas', type: 'uint256' },
//                 ],
//                 internalType: 'struct Transaction',
//                 name: '_tx',
//                 type: 'tuple',
//             },
//             {
//                 components: [
//                     { internalType: 'uint256', name: 'baseGas', type: 'uint256' },
//                     { internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
//                     { internalType: 'uint256', name: 'tokenGasPriceFactor', type: 'uint256' },
//                     { internalType: 'address', name: 'gasToken', type: 'address' },
//                     { internalType: 'address payable', name: 'refundReceiver', type: 'address' },
//                 ],
//                 internalType: 'struct FeeRefund',
//                 name: 'refundInfo',
//                 type: 'tuple',
//             },
//             { internalType: 'uint256', name: '_nonce', type: 'uint256' },
//         ],
//         name: 'encodeTransactionData',
//         outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'entryPoint',
//         outputs: [{ internalType: 'contract IEntryPoint', name: '', type: 'address' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 components: [
//                     { internalType: 'address', name: 'to', type: 'address' },
//                     { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//                     { internalType: 'uint256', name: 'value', type: 'uint256' },
//                     { internalType: 'bytes', name: 'data', type: 'bytes' },
//                     { internalType: 'uint256', name: 'targetTxGas', type: 'uint256' },
//                 ],
//                 internalType: 'struct Transaction',
//                 name: '_tx',
//                 type: 'tuple',
//             },
//             {
//                 components: [
//                     { internalType: 'uint256', name: 'baseGas', type: 'uint256' },
//                     { internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
//                     { internalType: 'uint256', name: 'tokenGasPriceFactor', type: 'uint256' },
//                     { internalType: 'address', name: 'gasToken', type: 'address' },
//                     { internalType: 'address payable', name: 'refundReceiver', type: 'address' },
//                 ],
//                 internalType: 'struct FeeRefund',
//                 name: 'refundInfo',
//                 type: 'tuple',
//             },
//             { internalType: 'bytes', name: 'signatures', type: 'bytes' },
//         ],
//         name: 'execTransaction',
//         outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
//         stateMutability: 'payable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'to', type: 'address' },
//             { internalType: 'uint256', name: 'value', type: 'uint256' },
//             { internalType: 'bytes', name: 'data', type: 'bytes' },
//             { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//         ],
//         name: 'execTransactionFromModule',
//         outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'to', type: 'address' },
//             { internalType: 'uint256', name: 'value', type: 'uint256' },
//             { internalType: 'bytes', name: 'data', type: 'bytes' },
//             { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//         ],
//         name: 'execTransactionFromModuleReturnData',
//         outputs: [
//             { internalType: 'bool', name: 'success', type: 'bool' },
//             { internalType: 'bytes', name: 'returnData', type: 'bytes' },
//         ],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 components: [
//                     { internalType: 'address', name: 'to', type: 'address' },
//                     { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//                     { internalType: 'uint256', name: 'value', type: 'uint256' },
//                     { internalType: 'bytes', name: 'data', type: 'bytes' },
//                     { internalType: 'uint256', name: 'targetTxGas', type: 'uint256' },
//                 ],
//                 internalType: 'struct Transaction',
//                 name: '_tx',
//                 type: 'tuple',
//             },
//             {
//                 components: [
//                     { internalType: 'uint256', name: 'baseGas', type: 'uint256' },
//                     { internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
//                     { internalType: 'uint256', name: 'tokenGasPriceFactor', type: 'uint256' },
//                     { internalType: 'address', name: 'gasToken', type: 'address' },
//                     { internalType: 'address payable', name: 'refundReceiver', type: 'address' },
//                 ],
//                 internalType: 'struct FeeRefund',
//                 name: 'refundInfo',
//                 type: 'tuple',
//             },
//             { internalType: 'bytes', name: 'signatures', type: 'bytes' },
//         ],
//         name: 'execTransaction_S6W',
//         outputs: [{ internalType: 'bool', name: 'success', type: 'bool' }],
//         stateMutability: 'payable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address[]', name: 'dest', type: 'address[]' },
//             { internalType: 'uint256[]', name: 'value', type: 'uint256[]' },
//             { internalType: 'bytes[]', name: 'func', type: 'bytes[]' },
//         ],
//         name: 'executeBatchCall',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address[]', name: 'dest', type: 'address[]' },
//             { internalType: 'uint256[]', name: 'value', type: 'uint256[]' },
//             { internalType: 'bytes[]', name: 'func', type: 'bytes[]' },
//         ],
//         name: 'executeBatchCall_4by',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'dest', type: 'address' },
//             { internalType: 'uint256', name: 'value', type: 'uint256' },
//             { internalType: 'bytes', name: 'func', type: 'bytes' },
//         ],
//         name: 'executeCall',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'dest', type: 'address' },
//             { internalType: 'uint256', name: 'value', type: 'uint256' },
//             { internalType: 'bytes', name: 'func', type: 'bytes' },
//         ],
//         name: 'executeCall_s1m',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'getChainId',
//         outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'getDeposit',
//         outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'getFallbackHandler',
//         outputs: [{ internalType: 'address', name: '_handler', type: 'address' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'getImplementation',
//         outputs: [{ internalType: 'address', name: '_implementation', type: 'address' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'start', type: 'address' },
//             { internalType: 'uint256', name: 'pageSize', type: 'uint256' },
//         ],
//         name: 'getModulesPaginated',
//         outputs: [
//             { internalType: 'address[]', name: 'array', type: 'address[]' },
//             { internalType: 'address', name: 'next', type: 'address' },
//         ],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'uint256', name: 'batchId', type: 'uint256' }],
//         name: 'getNonce',
//         outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'to', type: 'address' },
//             { internalType: 'uint256', name: 'value', type: 'uint256' },
//             { internalType: 'bytes', name: 'data', type: 'bytes' },
//             { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//             { internalType: 'uint256', name: 'targetTxGas', type: 'uint256' },
//             { internalType: 'uint256', name: 'baseGas', type: 'uint256' },
//             { internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
//             { internalType: 'uint256', name: 'tokenGasPriceFactor', type: 'uint256' },
//             { internalType: 'address', name: 'gasToken', type: 'address' },
//             { internalType: 'address payable', name: 'refundReceiver', type: 'address' },
//             { internalType: 'uint256', name: '_nonce', type: 'uint256' },
//         ],
//         name: 'getTransactionHash',
//         outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'uint256', name: 'gasUsed', type: 'uint256' },
//             { internalType: 'uint256', name: 'baseGas', type: 'uint256' },
//             { internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
//             { internalType: 'uint256', name: 'tokenGasPriceFactor', type: 'uint256' },
//             { internalType: 'address', name: 'gasToken', type: 'address' },
//             { internalType: 'address payable', name: 'refundReceiver', type: 'address' },
//         ],
//         name: 'handlePaymentRevert',
//         outputs: [{ internalType: 'uint256', name: 'requiredGas', type: 'uint256' }],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: '_owner', type: 'address' },
//             { internalType: 'address', name: '_handler', type: 'address' },
//         ],
//         name: 'init',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'address', name: 'module', type: 'address' }],
//         name: 'isModuleEnabled',
//         outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'bytes32', name: '_dataHash', type: 'bytes32' },
//             { internalType: 'bytes', name: '_signature', type: 'bytes' },
//         ],
//         name: 'isValidSignature',
//         outputs: [{ internalType: 'bytes4', name: '', type: 'bytes4' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     { inputs: [], name: 'nonce', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
//     {
//         inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
//         name: 'nonces',
//         outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
//     {
//         inputs: [
//             { internalType: 'address', name: 'token', type: 'address' },
//             { internalType: 'address', name: 'dest', type: 'address' },
//             { internalType: 'uint256', name: 'amount', type: 'uint256' },
//         ],
//         name: 'pullTokens',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: 'to', type: 'address' },
//             { internalType: 'uint256', name: 'value', type: 'uint256' },
//             { internalType: 'bytes', name: 'data', type: 'bytes' },
//             { internalType: 'enum Enum.Operation', name: 'operation', type: 'uint8' },
//         ],
//         name: 'requiredTxGas',
//         outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'address', name: 'handler', type: 'address' }],
//         name: 'setFallbackHandler',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'address', name: '_newOwner', type: 'address' }],
//         name: 'setOwner',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'bytes4', name: '_interfaceId', type: 'bytes4' }],
//         name: 'supportsInterface',
//         outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address payable', name: 'dest', type: 'address' },
//             { internalType: 'uint256', name: 'amount', type: 'uint256' },
//         ],
//         name: 'transfer',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'address', name: '_implementation', type: 'address' }],
//         name: 'updateImplementation',
//         outputs: [],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             {
//                 components: [
//                     { internalType: 'address', name: 'sender', type: 'address' },
//                     { internalType: 'uint256', name: 'nonce', type: 'uint256' },
//                     { internalType: 'bytes', name: 'initCode', type: 'bytes' },
//                     { internalType: 'bytes', name: 'callData', type: 'bytes' },
//                     { internalType: 'uint256', name: 'callGasLimit', type: 'uint256' },
//                     { internalType: 'uint256', name: 'verificationGasLimit', type: 'uint256' },
//                     { internalType: 'uint256', name: 'preVerificationGas', type: 'uint256' },
//                     { internalType: 'uint256', name: 'maxFeePerGas', type: 'uint256' },
//                     { internalType: 'uint256', name: 'maxPriorityFeePerGas', type: 'uint256' },
//                     { internalType: 'bytes', name: 'paymasterAndData', type: 'bytes' },
//                     { internalType: 'bytes', name: 'signature', type: 'bytes' },
//                 ],
//                 internalType: 'struct UserOperation',
//                 name: 'userOp',
//                 type: 'tuple',
//             },
//             { internalType: 'bytes32', name: 'userOpHash', type: 'bytes32' },
//             { internalType: 'uint256', name: 'missingAccountFunds', type: 'uint256' },
//         ],
//         name: 'validateUserOp',
//         outputs: [{ internalType: 'uint256', name: 'validationData', type: 'uint256' }],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address payable', name: 'withdrawAddress', type: 'address' },
//             { internalType: 'uint256', name: 'amount', type: 'uint256' },
//         ],
//         name: 'withdrawDepositTo',
//         outputs: [],
//         stateMutability: 'payable',
//         type: 'function',
//     },
//     { stateMutability: 'payable', type: 'receive' },
// ];

// export const smartAccountFactoryABI = [
//     { inputs: [{ internalType: 'address', name: '_basicImplementation', type: 'address' }], stateMutability: 'nonpayable', type: 'constructor' },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'account', type: 'address' },
//             { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
//             { indexed: true, internalType: 'uint256', name: 'index', type: 'uint256' },
//         ],
//         name: 'AccountCreation',
//         type: 'event',
//     },
//     {
//         anonymous: false,
//         inputs: [
//             { indexed: true, internalType: 'address', name: 'account', type: 'address' },
//             { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
//         ],
//         name: 'AccountCreationWithoutIndex',
//         type: 'event',
//     },
//     {
//         inputs: [],
//         name: 'accountCreationCode',
//         outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
//         stateMutability: 'pure',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'basicImplementation',
//         outputs: [{ internalType: 'address', name: '', type: 'address' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [{ internalType: 'address', name: '_owner', type: 'address' }],
//         name: 'deployAccount',
//         outputs: [{ internalType: 'address', name: 'proxy', type: 'address' }],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: '_owner', type: 'address' },
//             { internalType: 'uint256', name: '_index', type: 'uint256' },
//         ],
//         name: 'deployCounterFactualAccount',
//         outputs: [{ internalType: 'address', name: 'proxy', type: 'address' }],
//         stateMutability: 'nonpayable',
//         type: 'function',
//     },
//     {
//         inputs: [
//             { internalType: 'address', name: '_owner', type: 'address' },
//             { internalType: 'uint256', name: '_index', type: 'uint256' },
//         ],
//         name: 'getAddressForCounterFactualAccount',
//         outputs: [{ internalType: 'address', name: '_account', type: 'address' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
//     {
//         inputs: [],
//         name: 'minimalHandler',
//         outputs: [{ internalType: 'contract DefaultCallbackHandler', name: '', type: 'address' }],
//         stateMutability: 'view',
//         type: 'function',
//     },
// ];
