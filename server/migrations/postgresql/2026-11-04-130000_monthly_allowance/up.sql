ALTER TABLE decision_balances ADD COLUMN allowance_month VARCHAR(7) NOT NULL DEFAULT '';
ALTER TABLE decision_balances ADD COLUMN used_this_month INTEGER NOT NULL DEFAULT 0;
