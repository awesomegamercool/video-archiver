import json
import os

import boto3
import requests
from apify_client import ApifyClient
from botocore.exceptions import ClientError


USERNAME = os.environ["TIKTOK_USERNAME"].lstrip("@")

R2_ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
R2_BUCKET = os.environ["R2_BUCKET"]
R2_ACCESS_KEY_ID = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]

APIFY_TOKEN = os.environ["APIFY_TOKEN"]

# Actor used to discover videos from the profile.
APIFY_PROFILE_ACTOR = os.environ.get(
    "APIFY_PROFILE_ACTOR",
    "api-ninja/tiktok-profile-scraper",
)

# Actor used to download an individual video.
APIFY_DOWNLOADER_ACTOR = os.environ.get(
    "APIFY_DOWNLOADER_ACTOR",
    "api-ninja/tiktok-video-downloader",
)

STATE_KEY = "state/videos.json"

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

apify = ApifyClient(APIFY_TOKEN)


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


def get_latest_profile_videos():
    """
    Use Apify to discover the latest videos from the TikTok profile.

    This avoids yt-dlp's TikTok profile extractor, which is currently
    unreliable because TikTok keeps changing its profile/web responses.
    """

    profile_url = f"https://www.tiktok.com/@{USERNAME}"

    print(
        f"Checking @{USERNAME} for latest posts..."
    )

    print(
        f"Using Apify profile actor: "
        f"{APIFY_PROFILE_ACTOR}"
    )

    run = apify.actor(
        APIFY_PROFILE_ACTOR
    ).call(
        run_input={
            "userUrls": [profile_url],
            "scrapeType": "videos",
            "maxResults": 10,
            "scrapeAllResults": False,
        }
    )

    if not run:
        raise RuntimeError(
            "Apify profile scraper did not return a run."
        )

    dataset_id = run.default_dataset_id

    if not dataset_id:
        raise RuntimeError(
            "Apify profile scraper did not return a dataset."
        )

    items = list(
        apify.dataset(
            dataset_id
        ).iterate_items()
    )

    videos = []

    for item in items:
        video_id = str(
            item.get("video_id", "")
        ).strip()

        if not video_id:
            continue

        url = (
            item.get("url")
            or item.get("video_url")
            or f"https://www.tiktok.com/"
            f"@{USERNAME}/video/{video_id}"
        )

        videos.append(
            {
                "id": video_id,
                "url": url,
            }
        )

    print(
        f"Found {len(videos)} recent video IDs."
    )

    return videos


def run_apify(video_url):
    print(
        f"Sending new video to Apify: "
        f"{video_url}"
    )

    run = apify.actor(
        APIFY_DOWNLOADER_ACTOR
    ).call(
        run_input={
            "videoUrls": [video_url],
            "ttl": "none",
        }
    )

    if not run:
        raise RuntimeError(
            "Apify Actor did not return a run."
        )

    dataset_id = run.default_dataset_id

    if not dataset_id:
        raise RuntimeError(
            "Apify run did not return a dataset."
        )

    items = list(
        apify.dataset(
            dataset_id
        ).iterate_items()
    )

    if not items:
        raise RuntimeError(
            "Apify returned no video result."
        )

    return items[0]


def download_and_upload(video):
    video_id = video["id"]
    video_url = video["url"]

    result = run_apify(video_url)

    data = result.get("data", {})

    play_url = (
        result.get("data.hdplay")
        or result.get("data.play")
        or data.get("hdplay")
        or data.get("play")
    )

    print(
        "Apify result keys:",
        list(result.keys()),
    )

    if not play_url:
        raise RuntimeError(
            f"Apify returned no play URL "
            f"for {video_id}"
        )

    print(
        f"Downloading MP4 for {video_id}..."
    )

    response = requests.get(
        play_url,
        stream=True,
        timeout=120,
    )

    response.raise_for_status()

    key = (
        f"media/{video_id}.mp4"
    )

    print(
        f"Uploading {key} to R2..."
    )

    s3.upload_fileobj(
        response.raw,
        R2_BUCKET,
        key,
        ExtraArgs={
            "ContentType": "video/mp4",
        },
    )

    metadata = {
        "video_id": video_id,
        "tiktok_url": video_url,
        "apify_result": result,
    }

    s3.put_object(
        Bucket=R2_BUCKET,
        Key=f"media/{video_id}.json",
        Body=json.dumps(
            metadata,
            indent=2,
            default=str,
        ).encode("utf-8"),
        ContentType="application/json",
    )

    print(
        f"Archived video {video_id}."
    )


def main():
    archived = load_state()

    recent = get_latest_profile_videos()

    if not recent:
        print(
            "No videos detected; doing nothing."
        )
        return

    new_videos = [
        video
        for video in recent
        if video["id"] not in archived
    ]

    if not new_videos:
        print(
            "No new videos. Nothing to download."
        )
        return

    print(
        f"{len(new_videos)} new video(s) found."
    )

    # Process oldest → newest.
    for video in reversed(new_videos):
        try:
            download_and_upload(video)

            archived.add(video["id"])

            # Only mark a video as archived AFTER
            # the download and upload succeeded.
            save_state(archived)

        except Exception as exc:
            print(
                f"FAILED {video['id']}: {exc}"
            )

            # DO NOT mark failed videos as archived.
            #
            # The next scheduled run will retry them.
            continue

    print("Finished.")


if __name__ == "__main__":
    main()
