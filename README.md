# Private TikTok Archiver

Watches one **public** TikTok profile every 5 minutes with GitHub Actions,
downloads newly discovered public posts with yt-dlp, and stores them in a
private Cloudflare R2 bucket. A small password-protected Cloudflare Worker
can be deployed as the private gallery.

This project does not bypass private-account controls, CAPTCHAs, logins,
or other access controls. TikTok may change or block automated extraction,
so occasional downloader failures are possible.

## Why the repository should be public

GitHub currently provides free/unlimited standard hosted-runner usage for
public repositories. Private repositories use the account's included minute
quota. Keep all identifying/configuration values in GitHub Actions Secrets.

## 1. Create the Cloudflare R2 bucket

Cloudflare Dashboard → Storage & databases → R2 → Create bucket.

Suggested bucket name:

    private-tiktok-archive

Keep it private.

Then create an R2 API token scoped only to that bucket with Object Read & Write.
Copy:
- Account ID
- Access Key ID
- Secret Access Key
- Bucket name

## 2. Create a PUBLIC GitHub repository

Upload the files from this folder.

Do NOT put credentials or the TikTok username directly in the repository.

Go to:
Repository → Settings → Secrets and variables → Actions → New repository secret

Create these five secrets:

    TIKTOK_USERNAME
    R2_ACCOUNT_ID
    R2_BUCKET
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY

For this setup, set `TIKTOK_USERNAME` to the username you want watched,
without the leading @.

## 3. Run it once manually

GitHub → Actions → Archive TikTok → Run workflow.

Open the run and confirm it finishes. Then check the R2 bucket. New files
will appear under:

    media/

The persistent yt-dlp archive is stored at:

    state/archive.txt

The schedule is:

    */5 * * * *

which asks GitHub to run every five minutes. GitHub schedules can be delayed;
five minutes is the minimum supported schedule interval.

### Important public-repo GitHub behavior

GitHub automatically disables scheduled workflows in public repositories
after 60 days with no repository activity. If that happens, make a harmless
commit or re-enable the workflow in the Actions tab.

## 4. Deploy the private gallery

In `worker/wrangler.toml`, replace:

    REPLACE_WITH_YOUR_BUCKET_NAME

with the exact R2 bucket name.

Install Node.js, then from the `worker` directory run:

    npm install
    npx wrangler login
    npx wrangler secret put ARCHIVE_PASSWORD
    npx wrangler secret put SESSION_SECRET
    npm run deploy

For `ARCHIVE_PASSWORD`, use the password you want to type when opening the
gallery.

For `SESSION_SECRET`, use a long random string. Example way to generate one:

    python -c "import secrets; print(secrets.token_urlsafe(48))"

Wrangler will print the resulting `workers.dev` URL.

## Notes

- The R2 free tier currently includes 10 GB-month of Standard storage,
  1 million Class A operations/month, 10 million Class B operations/month,
  and free internet egress.
- The first run checks the newest 10 profile items. If the profile already
  has posts, those may be archived too.
- Each later run only downloads items not already recorded in archive.txt.
- `yt-dlp` is installed from its pre-release channel on every run so TikTok
  extractor fixes arrive quickly.
- TikTok can still block cloud/datacenter IPs or change its site. If that
  happens, the workflow may temporarily stop catching posts until yt-dlp
  supports the change again.
