module.exports = {
  apps: [
    {
      name: 'hot-wallet-scheduler',
      script: 'src/jobs/scheduler.ts',
      interpreter: 'node',
      interpreter_args: '-r ts-node/register',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
