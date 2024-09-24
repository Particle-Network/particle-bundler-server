import { IsArray, IsBoolean, IsOptional, MinLength, validate } from 'class-validator';
import { AppException } from '../../../common/app-exception';
import { plainToInstance } from 'class-transformer';

export class JsonRPCRequestDto {
    public readonly jsonrpc: string = '2.0';

    @IsOptional()
    public readonly id: any = 0;

    @MinLength(1)
    public readonly method: string;

    @IsOptional()
    @IsArray()
    public readonly params: any[] = [];

    @IsOptional()
    @IsBoolean()
    public readonly isAuth: boolean = false;

    @IsOptional()
    @IsBoolean()
    public readonly skipVerification: boolean = false;

    public static async fromPlainAndCheck(body: any): Promise<JsonRPCRequestDto> {
        const jsonRPCRequestDto: any = plainToInstance(JsonRPCRequestDto, body);
        const validationErrors = await validate(jsonRPCRequestDto);
        if (validationErrors.length > 0) {
            throw new AppException(-32602, JSON.stringify(validationErrors.map((e) => e.constraints)));
        }

        jsonRPCRequestDto.params = jsonRPCRequestDto.params ?? [];
        return jsonRPCRequestDto;
    }
}

export class JsonRPCResponse {
    public jsonrpc = '2.0';
    public id: any = 0;
    public result: object;
    public error: any;

    public static createSuccessResponse(jsonRPCRequestDto: JsonRPCRequestDto, result: any): any {
        const response = new JsonRPCResponse();

        response.jsonrpc = jsonRPCRequestDto.jsonrpc;
        response.id = jsonRPCRequestDto.id;
        response.result = result;

        return response;
    }

    public static createErrorResponse(jsonRPCRequestDto: JsonRPCRequestDto, error: any): any {
        if (error instanceof AppException) {
            return JsonRPCResponse.createErrorResponseFromAppException(jsonRPCRequestDto, error);
        }

        const newAppException = new AppException(-32000);
        const response = JsonRPCResponse.createErrorResponseFromAppException(jsonRPCRequestDto, newAppException);
        response.error.data = error?.message ?? error?.data;

        return response;
    }

    public static createErrorResponseFromAppException(jsonRPCRequestDto: JsonRPCRequestDto, appException: AppException) {
        const response = new JsonRPCResponse();
        if (jsonRPCRequestDto?.id) {
            response.id = jsonRPCRequestDto.id;
        }

        response.error = {
            code: appException.errorCode,
            message: appException.message,
            extraData: appException.extraData,
        };

        return response;
    }
}
