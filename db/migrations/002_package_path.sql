-- Packages can live in a subdirectory of a repository (monorepos), so one repository can hold several packages.
-- An empty path is the repository root.

ALTER TABLE packages
    ADD COLUMN repo_path VARCHAR(255) NOT NULL DEFAULT '' AFTER repo_name,
    DROP INDEX uq_packages_repo,
    ADD UNIQUE KEY uq_packages_repo (repo_owner, repo_name, repo_path);
