// PM2 ecosystem for B Visible.
//
// Loaded by deploy-once.sh after a successful build:
//   bash -lc 'pm2 startOrReload /opt/bvisible/app/ecosystem.config.cjs --update-env'
//
// `cwd` points at the Next.js standalone output produced when the build runs
// with NEXT_BUILD_STANDALONE=1 (the deploy queue exports that env var).
// Local Windows builds skip standalone (Windows symlink EPERM), so this file
// is server-runtime only.

module.exports = {
  apps: [
    {
      name: 'bvisible-web',
      script: 'server.js',
      cwd: '/opt/bvisible/app/apps/web/.next/standalone/apps/web',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // Allow Node up to 10s to clean up on SIGINT before SIGKILL.
      kill_timeout: 10000,
      // PM2 will mark the app `errored` if it exits within this window of
      // `start`. Generous because cold starts pull in Prisma/sharp.
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/opt/bvisible/shared/logs/pm2/bvisible-web.out.log',
      error_file: '/opt/bvisible/shared/logs/pm2/bvisible-web.err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        // Bind to localhost only. Public traffic enters via Nginx; never
        // expose Node directly. UFW also blocks :3000 publicly.
        HOSTNAME: '127.0.0.1',
      },
    },
  ],
};
