import os
import sys
import subprocess
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

USERNAME = os.environ["TIKTOK_USERNAME"].lstrip("@")
BUCKET = os.environ["R2_BUCKET"]
ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
COOKIES_FILE = os.environ.get("TIKTOK_COOKIES_FILE")

R2_ENDPOINT = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

STATE_KEY = "state/archive.txt"
DOWNLOAD_DIR = Path("downloads")
ARCHIVE_FILE = Path("archive.txt")

s3 = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="auto",
)


def restore_archive():
    try:
        s3.download_file(BUCKET, STATE_KEY, str(ARCHIVE_FILE))
        print("Restored download archive.")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey"):
            ARCHIVE_FILE.write_text("", encoding="utf-8")
            print("No previous archive state found; starting fresh.")
        else:
            raise


def run_ytdlp():
    DOWNLOAD_DIR.mkdir(exist_ok=True)

    url = f"https://www.tiktok.com/@{USERNAME}"

    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--impersonate",
        "chrome",
        "--no-progress",
        "--ignore-errors",
        "--download-archive",
        str(ARCHIVE_FILE),
        "--write-info-json",
        "--write-thumbnail",
        "--restrict-filenames",
        "--playlist-end",
        "10",
        "--output",
        str(DOWNLOAD_DIR / "%(upload_date|NA)s_%(id)s.%(ext)s"),
    ]

    if COOKIES_FILE:
        cmd.extend([
            "--cookies",
            COOKIES_FILE,
        ])

    cmd.append(url)

    print(f"Checking TikTok profile @{USERNAME}...")
    result = subprocess.run(cmd, check=False)

    if result.returncode != 0:
        print(f"yt-dlp exited with status {result.returncode}.")

    return result.returncode


def upload_new_files():
    uploaded = 0

    for path in DOWNLOAD_DIR.rglob("*"):
        if not path.is_file():
            continue

        key = f"media/{path.name}"

        extra = {}

        ext = path.suffix.lower()

        if ext == ".mp4":
            extra["ContentType"] = "video/mp4"
        elif ext == ".webm":
            extra["ContentType"] = "video/webm"
        elif ext == ".mov":
            extra["ContentType"] = "video/quicktime"
        elif ext in {".jpg", ".jpeg"}:
            extra["ContentType"] = "image/jpeg"
        elif ext == ".png":
            extra["ContentType"] = "image/png"
        elif ext == ".webp":
            extra["ContentType"] = "image/webp"
        elif ext == ".json":
            extra["ContentType"] = "application/json"

        if extra:
            s3.upload_file(
                str(path),
                BUCKET,
                key,
                ExtraArgs=extra,
            )
        else:
            s3.upload_file(
                str(path),
                BUCKET,
                key,
            )

        print(f"Uploaded: {key}")
        uploaded += 1

    return uploaded


def persist_archive():
    if ARCHIVE_FILE.exists():
        s3.upload_file(
            str(ARCHIVE_FILE),
            BUCKET,
            STATE_KEY,
            ExtraArgs={"ContentType": "text/plain"},
        )

        print("Saved archive state.")


def main():
    restore_archive()

    run_ytdlp()

    count = upload_new_files()

    persist_archive()

    print(f"Done. Uploaded {count} new file(s).")


if __name__ == "__main__":
    main()
