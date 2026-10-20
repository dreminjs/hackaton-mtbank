const app = require('../dist/main');

module.exports = async (req, res) => {
  const handler = app.default || app;
  return handler(req, res);
};
