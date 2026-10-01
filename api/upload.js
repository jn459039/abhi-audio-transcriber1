import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const body = req.body;

    const jsonResponse = await handleUpload({
      body,
      request: req,

      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: [
            "audio/*",
            "video/*"
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024
        };
      },

      onUploadCompleted: async ({ blob }) => {
        console.log("Audio uploaded:", blob.pathname);
      }
    });

    return res.status(200).json(jsonResponse);

  } catch (error) {
    return res.status(400).json({
      error: error.message || "Upload failed."
    });
  }
}
