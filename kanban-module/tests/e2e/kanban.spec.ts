/**
 * @file kanban-module/tests/e2e/kanban.spec.ts
 * @description Тест-кейс 15: Сквозное E2E-тестирование в Playwright.
 *
 * Сценарий:
 * 1. Открыть демо-приложение в браузере (http://localhost:3000);
 * 2. Открыть библиотеку шаблонов и выбрать шаблон №4 (Full-stack with database);
 * 3. Нажать «Применить и запустить»;
 * 4. Дождаться, пока все 5 карточек пройдут цепочку и окажутся в колонке «Done»;
 * 5. Убедиться через API-снапшот или атрибуты, что карточки 3 и 5 стартовали параллельно.
 */

import { test, expect } from '@playwright/test';

test.describe('Кейс 15: Сквозной E2E-сценарий (Playwright)', () => {
  test('Применение шаблона №4 (Full-stack with database) и параллельное выполнение карточек 3 и 5', async ({
    page,
    request,
  }) => {
    // 1. Открываем демо
    await page.goto('/');

    // Проверяем наличие заголовка
    await expect(page.locator('h1')).toContainText('Kanban');

    // 2. Открываем библиотеку шаблонов
    const templatesButton = page.locator('button:has-text("Библиотека шаблонов"), button:has-text("Шаблоны")').first();
    await templatesButton.click();

    // 3. Выбираем шаблон №4 "Full-stack with database"
    const templateCard = page.locator('div.group').filter({ hasText: 'Full-stack with database' });
    await expect(templateCard).toBeVisible();

    const selectButton = templateCard.locator('button:has-text("Выбрать шаблон")');
    await selectButton.click();

    // 4. В боковом чате нажимаем «Применить и запустить»
    const applyAndStartBtn = page.locator('button:has-text("Применить и запустить")');
    await expect(applyAndStartBtn).toBeVisible({ timeout: 5000 });
    await applyAndStartBtn.click();

    // 5. Ожидаем, пока все 5 карточек перейдут в колонку "Done" (Завершено)
    // Колонка Done имеет заголовок "Завершено (Done)"
    const doneColumn = page.locator('.kb-column:has-text("Done"), .kb-column:has-text("Завершено")').first();

    // Проверяем, что в колонке Done появилось 5 карточек (с таймаутом до 30с)
    await expect(async () => {
      const cardsInDone = await doneColumn.locator('.kb-task-card').count();
      expect(cardsInDone).toBe(5);
    }).toPass({ timeout: 30000, intervals: [500, 1000] });

    // 6. Проверяем параллельный запуск карточек 3 и 5
    // Запрашиваем состояние задач из API
    const response = await request.get('/api/kanban/boards/default/tasks');
    expect(response.ok()).toBeTruthy();
    const json = await response.json();
    const tasks = json.data as Array<{
      id: string;
      title: string;
      prompt: string;
      status: string;
      startedAt?: string;
      finishedAt?: string;
      meta?: any;
    }>;

    // Находим карточку 3 (CRUD API routes) и карточку 5 (seed script)
    const task3 = tasks.find((t) => t.prompt.includes('CRUD API routes') || t.title.includes('CRUD') || t.meta?.originalPlanId === '3');
    const task5 = tasks.find((t) => t.prompt.includes('seed script') || t.title.includes('seed') || t.meta?.originalPlanId === '5');

    expect(task3).toBeDefined();
    expect(task5).toBeDefined();
    expect(task3?.status).toBe('done');
    expect(task5?.status).toBe('done');

    const start3 = new Date(task3!.startedAt!).getTime();
    const start5 = new Date(task5!.startedAt!).getTime();

    // Карточки 3 и 5 стартовали после завершения карточки 2 практически одновременно (разница <= 300мс)
    const diff = Math.abs(start3 - start5);
    expect(diff).toBeLessThanOrEqual(300);
  });
});
