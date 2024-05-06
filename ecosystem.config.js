module.exports = {
    apps: [
        {
            name: 'particle-bundler-server',
            script: './dist/main.js',
            time: true,
            instances: process.env.ENVIRONMENT === 'production' ? 4 : 1,
            kill_timeout: 15000,
            exec_mode: 'cluster',
            max_memory_restart: '4096M',
            env_development: {
                ENVIRONMENT: 'dev',
                TZ: 'UTC',
                PARTICLE: '1',
            },
            env_debug: {
                ENVIRONMENT: 'debug',
                TZ: 'UTC',
                PARTICLE: '1',
            },
            env_production: {
                ENVIRONMENT: 'production',
                TZ: 'UTC',
                PARTICLE: '1',
            },
        },
    ],
};
