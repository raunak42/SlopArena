let appPromise;

module.exports = async function handler(request, response) {
  appPromise ??= import('../apps/api/src/index.js');
  const { default: app } = await appPromise;
  return app(request, response);
};
