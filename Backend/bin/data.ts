#!/usr/bin/env node
// Data stack only (tables + bucket). Same stack as in bin/backend.ts, but nothing bundles Lambdas, so synth takes
// seconds instead of minutes. Use it for the one-index-at-a-time table rollouts described in lib/data-stack.ts:
//   npm run deploy:data -- -c gsiStage=1
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';

new DataStack(new cdk.App(), 'MediCueDataStack');
