import { AppException } from './app-exception';

export class Helper {
    public static assertTrue(condition: any, failedExceptionCode: number, overrideMessage: any = '') {
        if (condition !== true) {
            throw new AppException(failedExceptionCode, overrideMessage);
        }
    }

    public static converErrorToString(error: any): string {
        if (error instanceof Error) {
            return error.message;
        }

        if (typeof error === 'object') {
            let cache = [];
            let str = JSON.stringify(error, function (key, value) {
                if (typeof value === 'object' && value !== null) {
                    if (cache.indexOf(value) !== -1) {
                        // Circular reference found, discard key
                        return;
                    }
                    // Store value in our collection
                    cache.push(value);
                }
                return value;
            });
            cache = null; // reset the cache
            return str;
        }

        if (error?.toString) {
            return error.toString();
        }

        return '';
    }

    public static createLarkBody(content: string, title: string) {
        return {
            msg_type: 'interactive',
            card: {
                config: {
                    wide_screen_mode: true,
                },
                header: {
                    title: {
                        content: title,
                        tag: 'plain_text',
                    },
                    template: 'red',
                },
                elements: [
                    {
                        tag: 'div',
                        text: {
                            tag: 'lark_md',
                            content: content.substring(0, 2048),
                        },
                    },
                ],
            },
        };
    }

    public static chunkString(str: string, size: number) {
        const numChunks = Math.ceil(str.length / size);
        const chunks = new Array(numChunks);

        for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
            chunks[i] = str.substr(o, size);
        }

        return chunks;
    }
}
