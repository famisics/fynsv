-- 使い方: psql -U admin -h <IP> -v db=<dbname> -f readonly-role.sql postgres
-- DB <db> への read-only ロール readonly_<db> を作成 (冪等)
SELECT format('CREATE ROLE readonly_%I NOLOGIN', :'db')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_' || :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO readonly_%I', :'db', :'db') \gexec
\c :db
SELECT format('GRANT USAGE ON SCHEMA public TO readonly_%I', :'db') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_%I', :'db') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_%I', :'db') \gexec
