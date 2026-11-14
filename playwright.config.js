'use strict';
/**
 * Testes de navegador real (Chromium) do Nuk_POS. `npm run test:e2e`.
 * Localmente, com o Chrome do sistema: E2E_CHROME=/usr/bin/google-chrome npm run test:e2e
 */
const { defineConfig } = require('@playwright/test');
const PORTA = Number(process.env.E2E_PORT || 3999);

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.js$/,
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // um só estabelecimento de demonstração: os testes partilham dados
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-PT',
    timezoneId: 'Africa/Luanda',
    ...(process.env.E2E_CHROME ? { launchOptions: { executablePath: process.env.E2E_CHROME } } : {}),
  },
  webServer: {
    command: 'node tests/e2e/servidor.js',
    url: `http://127.0.0.1:${PORTA}/api/health`,
    timeout: 90000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
