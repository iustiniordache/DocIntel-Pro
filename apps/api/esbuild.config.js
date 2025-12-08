import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['./src/lambda.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
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
