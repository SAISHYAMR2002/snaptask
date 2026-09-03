// One shared PrismaClient for the whole app. Import this everywhere
// instead of calling `new PrismaClient()` in each file.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
