-- Опросник сверки порядковых списаний ПТ (тест, филиал Chekhov Moms, сент-2026).
-- Тренер проходит по своей активной базе и подтверждает, что расчётный номер
-- следующего списания (N из M = initial_balance − balance + 1 из initial_balance)
-- совпадает с бумажными листами и 1С. Ответы собираются здесь; clients.balance
-- НЕ меняется — выравнивание отдельным осознанным шагом после сверки всех тренеров.
--
--  matches:
--    true      — «Да, совпадает» (истина = system_next/system_total)
--    false     — «Нет» + правильный номер (истина = final_next/final_total)
--    NULL      — ручное добавление упущенного клиента (is_manual=true), system_* пусты
--  final_next / final_total — согласованная истина для будущего выравнивания.

CREATE TABLE pt_sequence_survey (
  id            BIGSERIAL PRIMARY KEY,
  round         TEXT    NOT NULL,                                   -- метка прогона (SEQ_SURVEY.round)
  trainer_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id     UUID    NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
  branch        TEXT,
  system_next   INTEGER,                                           -- расчётное N (что показали); NULL у ручного
  system_total  INTEGER,                                           -- M = initial_balance; NULL у ручного
  matches       BOOLEAN,                                           -- Да/Нет; NULL у ручного добавления
  final_next    INTEGER NOT NULL,                                  -- согласованный следующий номер
  final_total   INTEGER,                                           -- согласованное M
  comment       TEXT,
  is_manual     BOOLEAN NOT NULL DEFAULT false,                    -- клиент добавлен вручную (не из авто-списка)
  answered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round, client_id)                                        -- upsert + резюме, защита от дублей
);

CREATE INDEX idx_seq_survey_branch_round ON pt_sequence_survey (branch, round);
CREATE INDEX idx_seq_survey_trainer_round ON pt_sequence_survey (trainer_id, round);

ALTER TABLE pt_sequence_survey ENABLE ROW LEVEL SECURITY;

-- Приложение работает под anon (страховка) и под authenticated (JWT_MODE='on').
-- Даём доступ обеим ролям (USING true), как у остальных таблиц фронта.
GRANT ALL ON pt_sequence_survey TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE pt_sequence_survey_id_seq TO anon, authenticated;

CREATE POLICY anon_seq_survey       ON pt_sequence_survey AS PERMISSIVE FOR ALL TO anon          USING (true) WITH CHECK (true);
CREATE POLICY anon_seq_survey_authed ON pt_sequence_survey AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
