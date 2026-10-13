-- The image creates the database `rack` (production). Staging gets its own database for the same user.
CREATE DATABASE IF NOT EXISTS rack_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON rack_staging.* TO 'rack'@'%';
