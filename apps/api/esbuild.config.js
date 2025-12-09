import * as esbuild from 'esbuild';

// Build main lambda bundle
await esbuild.build({
  entryPoints: ['./src/lambda.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: './build/lambda.js',
  minify: true,
  sourcemap: true,
  external: [
    'aws-sdk',
    '@aws-sdk/*',
    '@nestjs/microservices',
    '@nestjs/websockets',
    '@nestjs/platform-socket.io',
    'class-transformer/storage',
  ],
  metafile: true,
  treeShaking: true,
  logLevel: 'info',
});

console.log('✅ Lambda bundle created: ./build/lambda.js');

// Build individual handler bundles for CDK deployment
await esbuild.build({
  entryPoints: {
    'upload': './src/handlers/upload.handler.ts',
    'textract-start': './src/handlers/textract-start.handler.ts',
    'textract-complete': './src/handlers/textract-complete.handler.ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: './build/handlers',
  minify: false,
  sourcemap: true,
  external: [
    'aws-sdk',
    '@aws-sdk/*',
    '@nestjs/websockets/socket-module',
    '@nestjs/microservices/microservices-module',
    '@nestjs/microservices',
  ],
  metafile: true,
  treeShaking: true,
  logLevel: 'info',
});

console.log('✅ Handler bundles created: ./build/handlers/*.js');
