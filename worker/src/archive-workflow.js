import {
  WorkflowEntrypoint,
} from "cloudflare:workers";

const APIFY_ACTOR =
  "atomus/tiktok-scraper";

const APIFY_API =
  "https://api.apify.com/v2";

const PROFILE_URL =
  (username) =>
    `https://www.tiktok.com/@${username}`;

async function runApify(
  token,
  actor,
  input
) {
  const response = await fetch(
    `${APIFY_API}/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
    {
      method: "POST",

      headers: {
        "content-type": "application/json",
      },

      body: JSON.stringify(input),
    }
  );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Apify HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  const data =
    await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      "Apify returned an unexpected dataset."
    );
  }

  return data;
}


/*
 * Try to discover videos directly from
 * TikTok before spending any Apify credit.
 *
 * TikTok's public profile page sometimes
 * contains hydrated JSON containing the
 * current video feed.
 */
async function discoverDirectly(
  username
) {
  const url =
    PROFILE_URL(username);

  const response =
    await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

        "accept-language":
          "en-US,en;q=0.9",
      },
    });

  if (!response.ok) {
    throw new Error(
      `TikTok profile HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const jsonCandidates = [];

  const scriptPatterns = [
    /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i,
  ];

  for (
    const pattern of scriptPatterns
  ) {
    const match =
      html.match(pattern);

    if (!match) {
      continue;
    }

    try {
      jsonCandidates.push(
        JSON.parse(match[1])
      );
    } catch {
      // Try the next known structure.
    }
  }

  if (!jsonCandidates.length) {
    throw new Error(
      "TikTok profile contained no usable hydrated JSON."
    );
  }

  const videos = new Map();
  const now = Math.floor(Date.now() / 1000);

  function visit(value) {
    if (!value) {
      return;
    }

    if (
      typeof value !== "object"
    ) {
      return;
    }

    if (Array.isArray(value)) {
      for (
        const item of value
      ) {
        visit(item);
      }

      return;
    }

    const id =
      value.id ??
      value.aweme_id ??
      value.item_id ??
      value.video_id;

    const isVideoObject =
      Boolean(
        value.webVideoUrl ??
        value.web_video_url
      );

    if (!isVideoObject) {
      return;
    }

    const numericId =
      typeof id === "string" &&
      /^\d{15,25}$/.test(id)
        ? id
        : typeof id === "number"
          ? String(id)
          : null;

    if (numericId) {
      const possibleUrl =
        value.webVideoUrl ??
        value.web_video_url ??
        value.share_url ??
        value.url ??
        value.videoUrl;

      const isLikelyVideo =
        Boolean(
          possibleUrl ||
          value.video ||
          value.createTime ||
          value.create_time ||
          value.desc ||
          value.description
        );

      if (isLikelyVideo) {
        videos.set(
          numericId,
          {
            id: numericId,

            url:
              typeof possibleUrl ===
              "string" &&
              possibleUrl.includes("/video/")
                ? possibleUrl
                : `https://www.tiktok.com/@${username}/video/${numericId}`,
          }
        );
      }
    }

    for (
      const key of Object.keys(value)
    ) {
      visit(value[key]);
    }
  }

  for (
    const candidate of jsonCandidates
  ) {
    visit(candidate);
  }

  const result =
    [...videos.values()];

  if (!result.length) {
    throw new Error(
      "TikTok profile JSON was present, but no videos were found."
    );
  }

  return result.slice(0, 20);
}


/*
 * Apify fallback.
 *
 * This is intentionally NOT the normal
 * path. We only use it when direct TikTok
 * discovery stops working.
 */
async function discoverWithApify(
  env
) {
  const profile =
    PROFILE_URL(env.TIKTOK_USERNAME);

  console.log(
    "Direct TikTok discovery failed; using Apify fallback."
  );

  const results =
    await runApify(
      env.APIFY_TOKEN,
      "api-ninja/tiktok-profile-scraper",
      {
        userUrls: [profile],
        scrapeType: "videos",
        maxResults: 50,
        scrapeAllResults: false,
      }
    );

  return results
    .map((item) => {
      const id =
        item.video_id ??
        item.aweme_id;

      if (!id) {
        return null;
      }

      return {
        id: String(id),
        url:
          `https://www.tiktok.com/@${env.TIKTOK_USERNAME}/video/${id}`,
      };
    })
    .filter(Boolean);
}


/*
 * Insert newly discovered videos into D1.
 *
 * INSERT OR IGNORE is important:
 * two overlapping workflow instances
 * cannot create two records for the same
 * TikTok video.
 */
async function registerVideos(
  db,
  videos
) {
  if (!videos.length) {
    return [];
  }

  const statements =
    videos.map((video) =>
      db.prepare(`
        INSERT OR IGNORE INTO videos (
          id,
          tiktok_url,
          status,
          discovered_at
        )
        VALUES (?, ?, 'discovered', ?)
      `).bind(
        video.id,
        video.url,
        new Date().toISOString()
      )
    );

  await db.batch(statements);

  const ids =
    videos.map(
      (video) => video.id
    );

  const placeholders =
    ids.map(() => "?").join(",");

  const result =
    await db.prepare(`
      SELECT
        id,
        tiktok_url,
        status,
        attempts
      FROM videos
      WHERE id IN (${placeholders})
        AND status != 'archived'
      ORDER BY discovered_at ASC
    `).bind(...ids).all();

  return result.results ?? [];
}


/*
 * Claim one video.
 *
 * The UPDATE only succeeds when the
 * video is still in a claimable state.
 */
async function claimVideo(
  db,
  id
) {
  const result =
    await db.prepare(`
      UPDATE videos
      SET
        status = 'downloading',
        attempts = attempts + 1,
        last_attempt_at = ?
      WHERE
        id = ?
        AND status IN ('discovered', 'failed')
    `).bind(
      new Date().toISOString(),
      id
    ).run();

  return (
    (result.meta?.changes ?? 0) === 1
  );
}


async function markArchived(
  db,
  id
) {
  await db.prepare(`
    UPDATE videos
    SET
      status = 'archived',
      archived_at = ?,
      last_error = NULL
    WHERE id = ?
  `).bind(
    new Date().toISOString(),
    id
  ).run();
}


async function markFailed(
  db,
  id,
  error
) {
  await db.prepare(`
    UPDATE videos
    SET
      status = 'failed',
      last_error = ?
    WHERE id = ?
  `).bind(
    String(error).slice(0, 4000),
    id
  ).run();
}


async function downloadVideo(
  env,
  video
) {
  /*
   * Use the Apify TikTok scraper on the
   * specific video URL.
   *
   * shouldDownloadVideos adds a temporary
   * no-watermark CDN URL.
   *
   * We immediately stream that URL into R2.
   */
  const results =
    await runApify(
      env.APIFY_TOKEN,
      "dltik/tiktok-video-downloader",
      {
        urls: [
          video.tiktok_url,
        ],

        saveVideoFiles: true,

        videoQuality: "download",

        maxPerProfile: 10,

        proxyConfiguration: {
          useApifyProxy: false,
        },
      }
    );

  console.log(
    "Apify video results:",
    JSON.stringify(results).slice(0, 30000)
  );

  const item =
    results.find(
      (x) =>
        x.type === "video" &&
        String(
          x.video_id ?? ""
        ) === String(video.id)
    ) ??
    results.find(
      (x) =>
        x.type === "video"
    );

  if (!item) {
    throw new Error(
      "Apify returned no downloadable video."
    );
  }

  const downloadUrl =
    item.file_url ??
    item.download_url ??
    item.play_url;

  if (!downloadUrl) {
    throw new Error(
      "Apify returned no download URL."
    );
  }

  const response =
    await fetch(downloadUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

        "referer":
          "https://www.tiktok.com/",
      },
    });

  if (!response.ok) {
    throw new Error(
      `TikTok CDN returned HTTP ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error(
      "TikTok CDN returned an empty body."
    );
  }

  const key =
    `media/${video.id}.mp4`;

  await env.ARCHIVE.put(
    key,
    await response.arrayBuffer(),
    {
      httpMetadata: {
        contentType:
          "video/mp4",
      },
    }
  );

  await env.ARCHIVE.put(
    `media/${video.id}.json`,
    JSON.stringify(
      {
        video_id: video.id,
        tiktok_url:
          video.tiktok_url,
        archived_at:
          new Date().toISOString(),
        apify_result:
          item,
      },
      null,
      2
    ),
    {
      httpMetadata: {
        contentType:
          "application/json",
      },
    }
  );
}


export class ArchiveWorkflow
  extends WorkflowEntrypoint {

  async run(
    event,
    step
  ) {
    const env =
      this.env;

    console.log(
      `Archive check started: ${new Date().toISOString()}`
    );


    /*
     * STEP 1
     *
     * Discover the current profile.
     *
     * Direct TikTok is the normal path.
     * Apify is only fallback.
     */
    let recent;

    try {
      recent =
        await step.do(
          "discover TikTok videos",
          {
            retries: {
              limit: 2,
              delay: "10 seconds",
              backoff: "exponential",
            },

            timeout:
              "2 minutes",
          },

          async () => {
            try {
              return await discoverDirectly(
                env.TIKTOK_USERNAME
              );
            } catch (directError) {
              console.log(
                "Direct discovery failed:",
                directError
              );

              return await discoverWithApify(
                env
              );
            }
          }
        );
    } catch (error) {
      console.error(
        "Discovery failed:",
        error
      );

      return;
    }


    if (!recent.length) {
      console.log(
        "No videos found."
      );

      return;
    }


    /*
     * STEP 2
     *
     * Register everything atomically.
     */
    const candidates =
      await step.do(
        "register discovered videos",
        {
          retries: {
            limit: 5,
            delay: "5 seconds",
            backoff: "exponential",
          },

          timeout:
            "30 seconds",
        },

        async () => {
          return await registerVideos(
            env.DB,
            recent
          );
        }
      );


    if (!candidates.length) {
      console.log(
        "No unarchived videos."
      );

      return;
    }


    /*
     * Process at most five videos per
     * Workflow instance.
     *
     * This keeps us safely below the
     * Workflows Free step budget while
     * still allowing catch-up after downtime.
     */
    const work =
      candidates.slice(0, 5);


    for (
      const video of work
    ) {
      const claimed =
        await step.do(
          `claim ${video.id}`,
          {
            retries: {
              limit: 3,
              delay: "5 seconds",
              backoff: "exponential",
            },

            timeout:
              "30 seconds",
          },

          async () => {
            return await claimVideo(
              env.DB,
              video.id
            );
          }
        );


      if (!claimed) {
        continue;
      }


      try {
        await step.do(
          `archive ${video.id}`,
          {
            retries: {
              limit: 5,
              delay: "15 seconds",
              backoff: "exponential",
            },

            timeout:
              "10 minutes",
          },

          async () => {
            await downloadVideo(
              env,
              video
            );
          }
        );


        await step.do(
          `complete ${video.id}`,
          {
            retries: {
              limit: 5,
              delay: "5 seconds",
              backoff: "exponential",
            },

            timeout:
              "30 seconds",
          },

          async () => {
            await markArchived(
              env.DB,
              video.id
            );
          }
        );

      } catch (error) {
        console.error(
          `Failed ${video.id}:`,
          error
        );

        await step.do(
          `fail ${video.id}`,
          {
            retries: {
              limit: 5,
              delay: "5 seconds",
              backoff: "exponential",
            },

            timeout:
              "30 seconds",
          },

          async () => {
            await markFailed(
              env.DB,
              video.id,
              error
            );
          }
        );
      }
    }

    console.log(
      `Archive workflow finished. Processed ${work.length} candidate(s).`
    );
  }
}
