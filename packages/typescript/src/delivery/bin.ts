#!/usr/bin/env node
import { main } from './cli-main.js'

main().then((code) => process.exit(code))
