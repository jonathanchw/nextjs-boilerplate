import { TwitterApi } from "twitter-api-v2";
import dotenv from "dotenv";

dotenv.config();

// 🔑 Credenciales de la API de Twitter (almacenadas en .env)
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// 📌 Función para publicar un tweet
async function postToTwitter(text, imagePath) {
  try {
    const rwClient = client.readWrite;

    if (imagePath) {
      // 📸 Subir imagen antes de twittear
      const mediaId = await rwClient.v1.uploadMedia(imagePath);
      await rwClient.v2.tweet({ text, media: { media_ids: [mediaId] } });
    } else {
      await rwClient.v2.tweet(text);
    }

    console.log("✅ Tweet publicado correctamente!");
  } catch (error) {
    console.error("❌ Error al publicar en Twitter:", error);
  }
}

// 🚀 Exportar función
export { postToTwitter };
