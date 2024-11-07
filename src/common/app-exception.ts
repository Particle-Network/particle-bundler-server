import { isEmpty } from 'lodash';

export class AppException extends Error {
    public readonly errorCode: number;
    public readonly extraData: any;

    public constructor(errorCode: number, overrideMessage = '', extraData: any = null) {
        let appExceptionMessage = AppExceptionMessages.get(errorCode);
        if (!isEmpty(overrideMessage)) {
            appExceptionMessage = overrideMessage;
        }

        super(appExceptionMessage);
        this.errorCode = errorCode;
        this.extraData = extraData;
    }
}

export class AppExceptionMessages {
    public static readonly exceptionMessages = new Map<number, string>([
        // Custom
        [-32000, 'System error'],
        [-32001, 'Unsupported chainId'],
        [-32002, 'Arrays are not currently supported'],
        [-32003, 'Not supported entry point'],
        [-32004, 'The UserOP is already processed'],
        [-32005, 'Estimate gas failed'],
        [-32006, 'Invalid UserOp Nonce'],

        // JSON-RPC
        [-32600, 'Invalid Request'],
        [-32602, 'Invalid params'],
        [-32603, 'Not supported entry point'],

        // Bundler
        [-32604, 'Send user operation failed'],
        [-32605, 'Validate user operation failed'],
        [-32606, 'Simulate user operation failed'],
        [-32607, 'You have a transaction in pending status. Please try again later'],
        [-32608, 'The nonce is too big'],
        [-32609, 'The user operation pool is full, Please try again later'],
        [-32610, 'Invalid account nonce, please try again later'],
        [-32611, 'UserOp already known'],
        [-32612, 'Serialized transaction is not valid'],
        [-32613, 'This method must be authenticated'],
    ]);

    public static get(errorCode: number) {
        if (!this.exceptionMessages.has(errorCode)) {
            errorCode = -32000;
        }

        return this.exceptionMessages.get(errorCode);
    }

    public static messageExtend(errorCode: number, message: string) {
        if (!message) {
            return this.exceptionMessages.get(errorCode);
        }

        return `${this.exceptionMessages.get(errorCode)}: ${message}`;
    }
}
