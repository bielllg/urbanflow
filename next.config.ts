import type { NextConfig } from 'next';
import {fileURLToPath} from 'node:url';

const config: NextConfig = {
  poweredByHeader:false,
  devIndicators:false,
  turbopack:{root:fileURLToPath(new URL('.',import.meta.url))},
  serverExternalPackages:['pdfkit','pg'],
  outputFileTracingIncludes:{'/*':['./data/*.json']},
};

export default config;
