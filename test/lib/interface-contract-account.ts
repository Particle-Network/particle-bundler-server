import { BigNumberish } from 'ethers';

export interface IContractAccount {
    createUnsignedUserOp(info: any[], nonce?: any): Promise<any>;
    encodeExecute(target: string, value: BigNumberish, data: string): Promise<string>;
    getUserOpHash(userOp: any): any;
    signUserOpHash(userOp: any): any;
}
