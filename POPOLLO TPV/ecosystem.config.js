// PM2 (VPS): pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'popollo-tpv',
    script: 'server.js',
    node_args: '--no-warnings --env-file=.env',
    instances: 1,            // SQLite: una sola instancia
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '400M',
    time: true
  }]
};
