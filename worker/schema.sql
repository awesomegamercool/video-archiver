CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    tiktok_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'discovered',

    discovered_at TEXT NOT NULL,
    archived_at TEXT,

    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,

    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_status
ON videos(status);

CREATE INDEX IF NOT EXISTS idx_videos_discovered_at
ON videos(discovered_at);
