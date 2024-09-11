const os = require('os');
const { PRODUCTION_HOSTNAME } = require('./dist/common/common-types');
const { PROCESS_HANDLE_CHAINS } = require('./dist/configs/bundler-config-particle');
const hostname = os.hostname();

let instances = 0;
if (process.env.ENVIRONMENT === 'production') {
    if (hostname === PRODUCTION_HOSTNAME) {
        instances = PROCESS_HANDLE_CHAINS.length;
    } else {
        instances = 0;
    }
} else {
    instances = PROCESS_HANDLE_CHAINS.length;;
}

let max_memory_restart = '2048M';
if (hostname === PRODUCTION_HOSTNAME) {
    max_memory_restart = '7000M';
}

module.exports = {
    apps: [
        {
            name: 'particle-bundler-server',
            script: './dist/main.js',
            time: true,
            instances,
            kill_timeout: 15000,
            exec_mode: 'cluster',
            max_memory_restart,
            env_development: {
                ENVIRONMENT: 'dev',
                TZ: 'UTC',
                PARTICLE: '1',
            },
            env_debug: {
                ENVIRONMENT: 'debug',
                TZ: 'UTC',
                PARTICLE: '1',
                USE_LOCAL_NODE: '1',
            },
            env_production: {
                ENVIRONMENT: 'production',
                TZ: 'UTC',
                PARTICLE: '1',
                USE_LOCAL_NODE: '1',
            },
        },
    ],
};
