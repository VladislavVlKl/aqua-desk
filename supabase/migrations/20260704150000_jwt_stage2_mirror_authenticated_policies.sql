-- JWT этап 2: зеркальные политики для роли authenticated (аддитивно, прод не трогает).
-- Каждая anon-политика (USING true) продублирована для authenticated с теми же условиями,
-- чтобы при JWT_MODE='on' приложение работало 1:1. Ограничения доступа НЕ вводятся здесь —
-- это этап 3 (закрытие anon по одной таблице). Применено в прод 2026-07-04.
-- GRANT-ы authenticated идентичны anon; покрытие всех 44 таблиц фронта проверено.
DROP POLICY IF EXISTS anon_adult_gc_authed ON public.adult_group_clients; CREATE POLICY anon_adult_gc_authed ON public.adult_group_clients AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_insert_audit_authed ON public.audit_log; CREATE POLICY anon_insert_audit_authed ON public.audit_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS anon_read_audit_authed ON public.audit_log; CREATE POLICY anon_read_audit_authed ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS anon_all_branches_authed ON public.branches; CREATE POLICY anon_all_branches_authed ON public.branches AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_cat_recalc_authed ON public.category_recalc_requests; CREATE POLICY anon_all_cat_recalc_authed ON public.category_recalc_requests AS PERMISSIVE FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS anon_transfers_authed ON public.client_transfers; CREATE POLICY anon_transfers_authed ON public.client_transfers AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_clients_authed ON public.clients; CREATE POLICY anon_all_clients_authed ON public.clients AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_delete_reqs_authed ON public.delete_requests; CREATE POLICY anon_delete_reqs_authed ON public.delete_requests AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_duties_authed ON public.duties; CREATE POLICY anon_all_duties_authed ON public.duties AS PERMISSIVE FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS anon_parts_authed ON public.event_participants; CREATE POLICY anon_parts_authed ON public.event_participants AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_events_authed ON public.events; CREATE POLICY anon_events_authed ON public.events AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_group_attendance_authed ON public.group_attendance; CREATE POLICY anon_group_attendance_authed ON public.group_attendance AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_duplicate_flags_authed ON public.group_client_duplicate_flags; CREATE POLICY anon_all_duplicate_flags_authed ON public.group_client_duplicate_flags AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_group_clients_authed ON public.group_clients; CREATE POLICY anon_group_clients_authed ON public.group_clients AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_group_payments_authed ON public.group_payments; CREATE POLICY anon_group_payments_authed ON public.group_payments AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_group_progress_notes_authed ON public.group_progress_notes; CREATE POLICY anon_group_progress_notes_authed ON public.group_progress_notes AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_group_sessions_authed ON public.group_sessions; CREATE POLICY anon_all_group_sessions_authed ON public.group_sessions AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_group_subgroups_authed ON public.group_subgroups; CREATE POLICY anon_group_subgroups_authed ON public.group_subgroups AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_group_subs_authed ON public.group_substitutions; CREATE POLICY anon_group_subs_authed ON public.group_substitutions AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_group_types_authed ON public.group_types; CREATE POLICY anon_all_group_types_authed ON public.group_types AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_late_requests_authed ON public.late_workout_requests; CREATE POLICY anon_all_late_requests_authed ON public.late_workout_requests AS PERMISSIVE FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS anon_all_adjustments_authed ON public.month_adjustments; CREATE POLICY anon_all_adjustments_authed ON public.month_adjustments AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_notif_rules_authed ON public.notification_rules; CREATE POLICY anon_notif_rules_authed ON public.notification_rules AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_notif_queue_authed ON public.notifications_queue; CREATE POLICY anon_notif_queue_authed ON public.notifications_queue AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_insert_profiles_authed ON public.profiles; CREATE POLICY anon_insert_profiles_authed ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS anon_read_profiles_authed ON public.profiles; CREATE POLICY anon_read_profiles_authed ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS anon_update_profiles_authed ON public.profiles; CREATE POLICY anon_update_profiles_authed ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS anon_cancellations_authed ON public.schedule_cancellations; CREATE POLICY anon_cancellations_authed ON public.schedule_cancellations AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_confirmations_authed ON public.schedule_confirmations; CREATE POLICY anon_all_confirmations_authed ON public.schedule_confirmations AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_slots_authed ON public.schedule_slots; CREATE POLICY anon_all_slots_authed ON public.schedule_slots AS PERMISSIVE FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS anon_notes_authed ON public.session_notes; CREATE POLICY anon_notes_authed ON public.session_notes AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_subs_authed ON public.subscriptions; CREATE POLICY anon_subs_authed ON public.subscriptions AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_tech_bills_authed ON public.tech_bills; CREATE POLICY anon_tech_bills_authed ON public.tech_bills AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_tech_equipment_authed ON public.tech_equipment; CREATE POLICY anon_tech_equipment_authed ON public.tech_equipment AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_tech_issues_authed ON public.tech_issues; CREATE POLICY anon_tech_issues_authed ON public.tech_issues AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_tech_shopping_authed ON public.tech_shopping; CREATE POLICY anon_tech_shopping_authed ON public.tech_shopping AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_trainer_group_rate_history_authed ON public.trainer_group_rate_history; CREATE POLICY anon_trainer_group_rate_history_authed ON public.trainer_group_rate_history AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_trainer_groups_authed ON public.trainer_groups; CREATE POLICY anon_all_trainer_groups_authed ON public.trainer_groups AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_goals_authed ON public.training_goals; CREATE POLICY anon_goals_authed ON public.training_goals AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_trial_delete_requests_authed ON public.trial_delete_requests; CREATE POLICY anon_all_trial_delete_requests_authed ON public.trial_delete_requests AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_trials_authed ON public.trial_sessions; CREATE POLICY anon_all_trials_authed ON public.trial_sessions AS PERMISSIVE FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS anon_insert_sessions_authed ON public.user_sessions; CREATE POLICY anon_insert_sessions_authed ON public.user_sessions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS anon_read_sessions_authed ON public.user_sessions; CREATE POLICY anon_read_sessions_authed ON public.user_sessions AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS anon_all_workout_delete_requests_authed ON public.workout_delete_requests; CREATE POLICY anon_all_workout_delete_requests_authed ON public.workout_delete_requests AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all_workouts_authed ON public.workouts; CREATE POLICY anon_all_workouts_authed ON public.workouts AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
