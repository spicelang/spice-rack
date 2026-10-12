-- Spice Rack schema. All timestamps are UTC.

CREATE TABLE users (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    github_id     BIGINT UNSIGNED NOT NULL,
    login         VARCHAR(64)     NOT NULL,
    display_name  VARCHAR(255)    NOT NULL DEFAULT '',
    avatar_url    VARCHAR(512)    NOT NULL DEFAULT '',
    role          ENUM('maintainer', 'admin') NOT NULL DEFAULT 'maintainer',
    status        ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    created_at    DATETIME        NOT NULL,
    last_login_at DATETIME        NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_github_id (github_id),
    KEY idx_users_login (login)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE sessions (
    id           CHAR(64)        NOT NULL,
    user_id      BIGINT UNSIGNED NOT NULL,
    csrf         CHAR(32)        NOT NULL,
    github_token VARCHAR(255)    NOT NULL DEFAULT '',
    created_at   DATETIME        NOT NULL,
    expires_at   DATETIME        NOT NULL,
    PRIMARY KEY (id),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE oauth_states (
    state      CHAR(32)     NOT NULL,
    return_to  VARCHAR(255) NOT NULL DEFAULT '/dashboard',
    created_at DATETIME     NOT NULL,
    PRIMARY KEY (state)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE packages (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name              VARCHAR(64)     NOT NULL,
    description       VARCHAR(500)    NOT NULL DEFAULT '',
    repo_owner        VARCHAR(100)    NOT NULL,
    repo_name         VARCHAR(100)    NOT NULL,
    homepage          VARCHAR(255)    NOT NULL DEFAULT '',
    license           VARCHAR(64)     NOT NULL DEFAULT '',
    stars             INT UNSIGNED    NOT NULL DEFAULT 0,
    owner_id          BIGINT UNSIGNED NOT NULL,
    latest_version_id BIGINT UNSIGNED NULL,
    downloads_total   BIGINT UNSIGNED NOT NULL DEFAULT 0,
    readme_html       MEDIUMTEXT      NULL,
    synced_at         DATETIME        NULL,
    created_at        DATETIME        NOT NULL,
    updated_at        DATETIME        NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_packages_name (name),
    UNIQUE KEY uq_packages_repo (repo_owner, repo_name),
    KEY idx_packages_owner (owner_id),
    KEY idx_packages_downloads (downloads_total),
    KEY idx_packages_updated (updated_at),
    KEY idx_packages_synced (synced_at),
    CONSTRAINT fk_packages_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE package_tags (
    package_id BIGINT UNSIGNED NOT NULL,
    tag        VARCHAR(32)     NOT NULL,
    PRIMARY KEY (package_id, tag),
    KEY idx_package_tags_tag (tag),
    CONSTRAINT fk_package_tags_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE package_versions (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    package_id     BIGINT UNSIGNED NOT NULL,
    version        VARCHAR(64)     NOT NULL,
    tag_name       VARCHAR(128)    NOT NULL,
    title          VARCHAR(255)    NOT NULL DEFAULT '',
    changelog      MEDIUMTEXT      NULL,
    changelog_html MEDIUMTEXT      NULL,
    prerelease     TINYINT(1)      NOT NULL DEFAULT 0,
    tarball_url    VARCHAR(512)    NOT NULL DEFAULT '',
    published_at   DATETIME        NOT NULL,
    downloads      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_versions_package_version (package_id, version),
    KEY idx_versions_published (package_id, published_at),
    CONSTRAINT fk_versions_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE packages
    ADD CONSTRAINT fk_packages_latest FOREIGN KEY (latest_version_id) REFERENCES package_versions (id) ON DELETE SET NULL;

CREATE TABLE package_dependencies (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    version_id      BIGINT UNSIGNED NOT NULL,
    dep_name        VARCHAR(64)     NOT NULL,
    constraint_text VARCHAR(64)     NOT NULL DEFAULT '*',
    dev             TINYINT(1)      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_deps_version_name (version_id, dep_name),
    KEY idx_deps_name (dep_name),
    CONSTRAINT fk_deps_version FOREIGN KEY (version_id) REFERENCES package_versions (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE package_stats_daily (
    package_id BIGINT UNSIGNED NOT NULL,
    day        DATE            NOT NULL,
    downloads  INT UNSIGNED    NOT NULL DEFAULT 0,
    views      INT UNSIGNED    NOT NULL DEFAULT 0,
    PRIMARY KEY (package_id, day),
    KEY idx_stats_day (day),
    CONSTRAINT fk_stats_package FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
