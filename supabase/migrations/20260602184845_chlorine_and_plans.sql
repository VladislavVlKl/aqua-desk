
-- Закуп хлора
CREATE TABLE IF NOT EXISTS chlorine_orders (
  id          serial PRIMARY KEY,
  branch      text NOT NULL,
  order_date  date NOT NULL DEFAULT CURRENT_DATE,
  quantity_kg numeric NOT NULL,
  price_total numeric NOT NULL,
  supplier    text,
  note        text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE chlorine_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_chlorine ON chlorine_orders FOR ALL USING (true) WITH CHECK (true);

-- Планы (стратегия/календарь/ивенты/задачи)
CREATE TABLE IF NOT EXISTS ops_plans (
  id          serial PRIMARY KEY,
  branch      text,
  plan_type   text NOT NULL, -- 'strategy' | 'calendar' | 'event' | 'task'
  title       text NOT NULL,
  description text,
  due_date    date,
  status      text DEFAULT 'active', -- 'active' | 'done' | 'cancelled'
  created_by  integer REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE ops_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_ops_plans ON ops_plans FOR ALL USING (true) WITH CHECK (true);


