const parseCsvOrigins = (csv) =>
  String(csv || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://bank-11-client.vercel.app',
  'https://bank-11-frontend.vercel.app'
];

export const getAllowedOrigins = () => {
  const envOrigins = [
    ...parseCsvOrigins(process.env.CORS_ORIGINS),
    ...parseCsvOrigins(process.env.SOCKET_CORS_ORIGINS),
    ...parseCsvOrigins(process.env.FRONTEND_BASE_URL)
  ];

  const uniqueOrigins = new Set([...DEFAULT_ORIGINS, ...envOrigins]);
  return [...uniqueOrigins];
};
