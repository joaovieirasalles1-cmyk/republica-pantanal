// Função da Vercel: todas as rotas /api/* (e /qr.svg) passam por aqui.
import { handler } from '../server.mjs';
export default handler;
export const config = { api: { bodyParser: false } };
