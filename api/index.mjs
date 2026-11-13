// Função da Vercel quando o deploy sai do GitHub (a Vercel monta a partir da raiz do repositório).
// O código de verdade fica em app/; este arquivo só aponta para ele.
import { handler } from '../app/server.mjs';
export default handler;
export const config = { api: { bodyParser: false } };
