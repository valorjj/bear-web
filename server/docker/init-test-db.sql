-- Runs once, automatically, only when MariaDB initialises an EMPTY data
-- volume (mariadb's docker-entrypoint runs everything under
-- /docker-entrypoint-initdb.d on first boot only). MARIADB_DATABASE in
-- docker-compose.yml creates exactly one database (`markflowing`, the dev
-- database); this script creates the second one the test suite needs so the
-- two are never the same database and tests can never truncate dev data.
--
-- The volume for THIS project's container was already initialised before
-- this script existed, so it will not run against that container — the
-- second database there was created once by hand via `docker exec`. This
-- file exists for anyone who starts fresh (a new checkout, a wiped volume,
-- a teammate's machine).
CREATE DATABASE IF NOT EXISTS markflowing_test;
GRANT ALL PRIVILEGES ON markflowing_test.* TO 'markflowing'@'%';
FLUSH PRIVILEGES;
