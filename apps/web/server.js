import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = join(__dirname, 'dist');

app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(express.static(distDir));

app.get('*', (_request, response) => {
  response.sendFile(join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`sloparena-web listening on http://localhost:${port}`);
});
