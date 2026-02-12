'use strict';

function defineAgent(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('defineAgent() requires an object definition');
  }

  const meta = definition.meta && typeof definition.meta === 'object'
    ? definition.meta
    : {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        version: definition.version,
        capabilities: definition.capabilities,
        permissions: definition.permissions,
      };

  if (!meta || typeof meta.name !== 'string' || meta.name.trim() === '') {
    throw new Error('Agent meta.name is required');
  }

  if (typeof meta.version !== 'string' || meta.version.trim() === '') {
    meta.version = '0.0.0';
  }

  if (!Array.isArray(meta.capabilities)) {
    meta.capabilities = [];
  }

  const run = definition.run;
  if (typeof run !== 'function') {
    throw new Error('Agent run(task, ctx) function is required');
  }

  return {
    meta,
    run,
  };
}

module.exports = {
  defineAgent,
};
