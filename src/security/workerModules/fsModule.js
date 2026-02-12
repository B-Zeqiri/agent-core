const fs = require('fs').promises;
const path = require('path');

module.exports = async function(payload) {
  // payload: { args, metadata }
  const { args, metadata } = payload || {};
  const sandboxRoot = (metadata && metadata.sandboxRoot) ? metadata.sandboxRoot : process.cwd();

  function resolvePath(filePath) {
    const resolved = path.resolve(sandboxRoot, filePath);
    const relative = path.relative(sandboxRoot, resolved);
    if (relative.startsWith('..')) throw new Error('Path traversal not allowed');
    return resolved;
  }

  const operation = args.operation;
  const filePath = resolvePath(args.path);

  switch (operation) {
    case 'read':
      return await fs.readFile(filePath, 'utf-8');
    case 'write':
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.content, 'utf-8');
      return undefined;
    case 'append':
      await fs.appendFile(filePath, args.content, 'utf-8');
      return undefined;
    case 'delete':
      try {
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          await fs.rm(filePath, { recursive: true });
        } else {
          await fs.unlink(filePath);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      return undefined;
    case 'exists':
      try { await fs.access(filePath); return true; } catch { return false; }
    case 'list':
      const entries = await fs.readdir(filePath, { withFileTypes: true });
      return entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
    case 'mkdir':
      await fs.mkdir(filePath, { recursive: true });
      return undefined;
    default:
      throw new Error('Unknown operation: ' + operation);
  }
};
