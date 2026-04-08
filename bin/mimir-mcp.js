#!/usr/bin/env node

require('ts-node').register({
  compilerOptions: {
    module: "commonjs",
    esModuleInterop: true
  }
});

require('../src/mcp.ts');
