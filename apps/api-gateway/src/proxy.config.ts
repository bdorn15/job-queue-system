export const proxyRoutes = [
  {
    path: '/auth',
    target: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3002',
  },
  {
    path: '/jobs',
    target: process.env.JOB_SERVICE_URL ?? 'http://localhost:3001',
  },
];
