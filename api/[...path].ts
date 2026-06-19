import app from '../apps/api/src/index';

export default function handler(request: any, response: any) {
  return app(request, response);
}
