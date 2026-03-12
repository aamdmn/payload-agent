#!/usr/bin/env node

import { register } from 'tsx/esm/api'

// Register tsx so we can dynamically import .ts files (user's payload.config.ts)
register()

import('../dist/cli.js')
