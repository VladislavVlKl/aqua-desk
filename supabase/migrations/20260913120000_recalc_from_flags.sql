-- Статья ЗП «Разница от пересчёта» (сверка с 1С) теперь читается НАПРЯМУЮ из
-- pt_mismatch_flags (fot_delta + client_id + resolved_at), а не дублируется строкой
-- в month_adjustments. resolvePtMismatch (db.ops.js) больше НЕ пишет корректировку
-- в month_adjustments. Это устраняет:
--   • дубль (та же сумма и во флаге, и в month_adjustments);
--   • коллизию UNIQUE(trainer_id, year, month, branch) при втором перерасчёте
--     в том же филиале/месяце или перерасчёте поверх ручной премии (был голый INSERT).
--
-- Удаляем ранее записанные перерасчётные строки, чтобы после переезда логики сумма
-- не посчиталась дважды (через флаг И через bonus/penalty). Данные НЕ теряются —
-- та же дельта уже лежит в pt_mismatch_flags.fot_delta.
-- На момент миграции такая строка одна (Ващенко Анна, сентябрь 2026, 650 000).
DELETE FROM month_adjustments WHERE notes LIKE 'Перерасчёт ПТ%';

-- Индекс для чтения статьи «Разница от пересчёта» по тренеру/месяцу (resolved-флаги).
CREATE INDEX IF NOT EXISTS idx_ptmf_trainer_resolved
  ON pt_mismatch_flags (trainer_id, status, resolved_at);
