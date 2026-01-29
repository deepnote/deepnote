#!/usr/bin/env node
import { startServer } from './server'

startServer().catch(() => {
  // Error already logged by server
  process.exit(1)
})
