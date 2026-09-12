import json
import os
import tempfile
from datetime import datetime, timezone

import boto3
import requests
import yt_dlp
from yt_dlp.networking.impersonate import ImpersonateTarget
from botocore.exceptions import ClientError


USERNAME = os.environ["TIKTOK_USERNAME"].lstrip("@")

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID")
R2_BUCKET = os.environ.get("R2_BUCKET")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
TIKTOK_COOKIES_FILE = os.environ.get("TIKTOK_COOKIES_FILE")

STATE_KEY = "state/videos.json"

s3 = None

if all(
    (
        R2_ACCOUNT_ID,
        R2_BUCKET,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
    )
):
    R2_ENDPOINT = (
        f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    )

    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_state():
    try:
        response = s3.get_object(
            Bucket=R2_BUCKET,
            Key=STATE_KEY,
        )

        data = json.loads(
            response["Body"].read().decode("utf-8")
        )

        return set(data.get("video_ids", []))

    except ClientError as exc:
        code = exc.response.get(
            "Error", {}
        ).get("Code", "")

        if code in (
            "NoSuchKey",
            "404",
            "NoSuchObject",
        ):
            return set()

        raise


def save_state(video_ids):
    body = json.dumps(
        {
            "username": USERNAME,
            "video_ids": sorted(video_ids),
        },
        indent=2,
    ).encode("utf-8")

    s3.put_object(
        Bucket=R2_BUCKET,
        Key=STATE_KEY,
        Body=body,
        ContentType="application/json",
    )

    print("Saved state.")


def discover_profile():
    """
    Ask yt-dlp to extract the profile's current posts.

    We intentionally do not apply an age filter. This means a video
    that becomes public again can still be discovered.
    """

    profile_url = (
        f"https://www.tiktok.com/@{USERNAME}"
    )

    print(
        f"Checking @{USERNAME} for latest TikToks..."
    )

    options = {
        "quiet": True,
        "no_warnings": False,
        "extract_flat": True,
        "skip_download": True,
        "impersonate": ImpersonateTarget(
            "chrome",
            "136",
            "macos",
            "15",
        ),
        "cookiefile": TIKTOK_COOKIES_FILE,
    }

    last_error = None
    info = None

    for attempt in range(3):
        try:
            print(
                f"Profile discovery attempt "
                f"{attempt + 1}/3..."
            )

            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(
                    profile_url,
                    download=False,
                )

            last_error = None
            break

        except Exception as exc:
            last_error = exc

            print(
                f"Profile discovery attempt "
                f"{attempt + 1}/3 failed: {exc}"
            )

    if last_error is not None:
        raise last_error

    entries = info.get("entries") or []

    videos = []

    for entry in entries:
        if not entry:
            continue

        video_id = str(
            entry.get("id") or ""
        ).strip()

        if not video_id:
            continue

        url = (
            entry.get("webpage_url")
            or entry.get("url")
            or f"https://www.tiktok.com/"
            f"@{USERNAME}/video/{video_id}"
        )

        if "/video/" not in url:
            url = (
                f"https://www.tiktok.com/"
                f"@{USERNAME}/video/{video_id}"
            )

        videos.append(
            {
                "id": video_id,
                "url": url,
            }
        )

    # Remove duplicate IDs while preserving order.
    unique = {}
    for video in videos:
        unique.setdefault(
            video["id"],
            video,
        )

    videos = list(unique.values())

    print(
        f"Found {len(videos)} profile posts."
    )

    return videos


def is_photo_post(video_url):
    """
    Determine whether a TikTok post is a photo/slideshow.

    TikWM exposes an `images` array for photo posts. Normal
    videos do not use that field, so we use it to identify
    photo posts before choosing the download path.
    """

    response = requests.post(
        "https://www.tikwm.com/api/",
        data={
            "url": video_url,
        },
        headers={
            "User-Agent": (
                "Mozilla/5.0 "
                "(Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/140 Safari/537.36"
            ),
        },
        timeout=60,
    )

    response.raise_for_status()

    result = response.json()

    if result.get("code") != 0:
        raise RuntimeError(
            "TikWM returned an error: "
            + str(result.get("msg"))
        )

    data = result.get("data") or {}

    return bool(data.get("images"))


def download_video(video):
    video_id = video["id"]
    video_url = video["url"]

    print(f"Downloading video {video_id}...")

    output_template = os.path.join(
        tempfile.gettempdir(),
        f"tiktok_{video_id}.%(ext)s",
    )

    options = {
        "outtmpl": output_template,
        "format": "bestvideo*+bestaudio/best",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": False,
        "no_warnings": False,
        "cookiefile": TIKTOK_COOKIES_FILE,
    }

    last_error = None

    for attempt in range(3):
        try:
            print(
                f"yt-dlp attempt {attempt + 1}/3 "
                f"for {video_id}..."
            )

            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.download([video_url])

            last_error = None
            break

        except Exception as exc:
            last_error = exc

            print(
                f"yt-dlp attempt {attempt + 1}/3 failed: "
                f"{exc}"
            )

    if last_error is not None:
        raise last_error

    media_path = None

    for filename in os.listdir(tempfile.gettempdir()):
        if filename.startswith(
            f"tiktok_{video_id}."
        ):
            candidate = os.path.join(
                tempfile.gettempdir(),
                filename,
            )

            if os.path.isfile(candidate):
                media_path = candidate
                break

    if media_path is None:
        raise RuntimeError(
            f"yt-dlp reported success, but no downloaded "
            f"media file was found for {video_id}."
        )

    print(
        f"Found downloaded file: {media_path}"
    )

    extension = os.path.splitext(
        media_path
    )[1].lower()

    if extension == ".mp4":
        content_type = "video/mp4"
    elif extension == ".webm":
        content_type = "video/webm"
    elif extension == ".mkv":
        content_type = "video/x-matroska"
    elif extension == ".m4a":
        content_type = "audio/mp4"
    elif extension == ".mp3":
        content_type = "audio/mpeg"
    else:
        content_type = "application/octet-stream"

    archive_extension = (
        extension[1:]
        if extension
        else "bin"
    )

    archive_key = (
        f"media/{video_id}.{archive_extension}"
    )

    with open(media_path, "rb") as file:
        s3.put_object(
            Bucket=R2_BUCKET,
            Key=archive_key,
            Body=file,
            ContentType=content_type,
        )

    metadata = {
        "id": video_id,
        "url": video_url,
        "type": "video",
        "file": archive_key,
        "archived_at": now_iso(),
    }

    s3.put_object(
        Bucket=R2_BUCKET,
        Key=f"metadata/{video_id}.json",
        Body=json.dumps(
            metadata,
            indent=2,
        ).encode("utf-8"),
        ContentType="application/json",
    )

    try:
        os.remove(media_path)
    except OSError:
        pass

    print(
        f"Archived video {video_id}."
    )


def download_photo_post(video):
    """
    Download a TikTok photo/slideshow through TikWM.

    TikTok photo posts currently do not reliably expose their
    individual images through yt-dlp, while TikWM returns the
    ordered image URLs.
    """

    video_id = video["id"]
    video_url = video["url"]

    print(
        f"Resolving photo post {video_id}..."
    )

    response = requests.post(
        "https://www.tikwm.com/api/",
        data={
            "url": video_url,
        },
        headers={
            "User-Agent": (
                "Mozilla/5.0 "
                "(Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/140 Safari/537.36"
            ),
        },
        timeout=60,
    )

    response.raise_for_status()

    result = response.json()

    if result.get("code") != 0:
        raise RuntimeError(
            "TikWM returned an error: "
            + str(result.get("msg"))
        )

    data = result.get("data") or {}

    images = data.get("images") or []

    if not images:
        raise RuntimeError(
            f"TikWM returned no images for {video_id}"
        )

    print(
        f"Found {len(images)} image(s)."
    )

    for index, image_url in enumerate(
        images,
        start=1,
    ):
        image_response = requests.get(
            image_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 "
                    "(Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 "
                    "(KHTML, like Gecko) "
                    "Chrome/140 Safari/537.36"
                ),
            },
            timeout=120,
        )

        image_response.raise_for_status()

        key = (
            f"media/{video_id}/"
            f"{index:03d}.jpg"
        )

        print(
            f"Uploading {key}..."
        )

        s3.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=image_response.content,
            ContentType="image/jpeg",
        )

    save_metadata(
        video,
        {
            "type": "photo",
            "video_id": video_id,
            "tiktok_url": video_url,
            "image_count": len(images),
            "archived_at": now_iso(),
        },
    )

    print(
        f"Archived photo post {video_id}."
    )


def save_metadata(video, metadata):
    s3.put_object(
        Bucket=R2_BUCKET,
        Key=f"media/{video['id']}.json",
        Body=json.dumps(
            metadata,
            indent=2,
        ).encode("utf-8"),
        ContentType="application/json",
    )


def archive_video(video):
    try:
        download_video(video)
        return
    except Exception as video_error:
        print(
            f"yt-dlp could not download {video['id']} "
            f"as a video: {video_error}"
        )

    print(
        f"Checking {video['id']} for photo/slideshow..."
    )

    if is_photo_post(video["url"]):
        download_photo_post(video)
        return

    raise RuntimeError(
        f"Could not archive {video['id']} "
        f"as either a video or photo post."
    )


def main():
    archived = load_state()

    recent = discover_profile()

    if not recent:
        print(
            "No posts detected; doing nothing."
        )
        return

    new_posts = [
        video
        for video in recent
        if video["id"] not in archived
    ]

    if not new_posts:
        print(
            "No new posts. Nothing to download."
        )
        return

    print(
        f"{len(new_posts)} new post(s) found."
    )

    # Process oldest → newest.
    for video in reversed(new_posts):
        try:
            archive_video(video)

            # Only mark the post archived after all media
            # and metadata uploads have succeeded.
            archived.add(video["id"])
            save_state(archived)

        except Exception as exc:
            print(
                f"FAILED {video['id']}: {exc}"
            )

            # Do not mark failed posts as archived.
            # A later run will retry them.
            continue

    print("Finished.")


if __name__ == "__main__":
    main()