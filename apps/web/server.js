import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = join(__dirname, 'dist');

app.use(express.static(distDir));

app.get('*', (_request, response) => {
  response.sendFile(join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`usageboard-web listening on http://localhost:${port}`);
});
