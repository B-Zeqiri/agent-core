module.exports = async function(args) {
  const ms = args.delay || 2000;
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), ms));
};
