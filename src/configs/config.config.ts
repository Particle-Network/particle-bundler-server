export const configConfig: any = {
    envFilePath: `${__dirname}/../../.env${!process.env.ENVIRONMENT ? '' : `.${process.env.ENVIRONMENT}`}`,
    cache: true,
    isGlobal: true,
};
