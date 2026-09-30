# Abhi Audio Transcriber

Custom responsive audio transcription app with editable output and `.txt` downloads.

## Publish a reusable link
1. Upload this folder's contents to a GitHub repository.
2. Import the repository into Vercel (https://vercel.com/new).
3. Add `OPENAI_API_KEY` in Project Settings → Environment Variables.
4. Deploy. Share the resulting `*.vercel.app` URL; it can be bookmarked and reused.
5. Set usage limits in your OpenAI Platform account before sharing the public link.

The app has no transcript-history database. Audio is processed by OpenAI's transcription API. Anyone with the public URL can submit files. Current upload limit: 25 MB.
