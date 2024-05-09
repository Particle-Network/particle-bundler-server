const os = require('os');
const hostname = os.hostname();

let instances = 0;
if (process.env.ENVIRONMENT === 'production') {
    if (hostname === 'particle-bundler-server-handler') {
        instances = 1;
    } else {
        instances = 0;
    }
} else {
    instances = 3;
}

let max_memory_restart = '2048M';
if (hostname === 'particle-bundler-server-handler') {
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
            },
            env_production: {
                ENVIRONMENT: 'production',
                TZ: 'UTC',
                PARTICLE: '1',
            },
        },
    ],
};
