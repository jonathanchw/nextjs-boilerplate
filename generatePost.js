import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { createCanvas, loadImage } from "canvas";
import { postToTwitter } from "./postToTwitter.js";
import {
  generateTextWithResilience,
  LlmSoftUnavailableError,
  LlmUserFacingError,
} from "./lib/llmResilience.js";
import { nextTitleHistoryAfterMark } from "./lib/titleRotation.js";

dotenv.config();
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PLACEHOLDER_IMAGE = "https://via.placeholder.com/600";
const TITLES_FILE = path.join(process.cwd(), "usedTitles.json");
const MAX_HISTORY = 100;

// Cargar historial de títulos
function loadTitleHistory() {
  if (fs.existsSync(TITLES_FILE)) {
    return JSON.parse(fs.readFileSync(TITLES_FILE, "utf8"));
  }
  return [];
}

// Guardar historial de títulos
function saveTitleHistory(history) {
  fs.writeFileSync(TITLES_FILE, JSON.stringify(history.slice(-MAX_HISTORY)), "utf8");
}

// Generar un título aleatorio sin repetición
const TITLES_JSON_FILE = path.join(process.cwd(), "titles.json");

// Cargar títulos desde titles.json
function loadPossibleTitles() {
  if (fs.existsSync(TITLES_JSON_FILE)) {
    return JSON.parse(fs.readFileSync(TITLES_JSON_FILE, "utf8"));
  }
  return [];
}

/** Pick a title without persisting — call markTitleUsed only after the post file is written. */
function pickUniqueTitle() {
  const possibleTitles = loadPossibleTitles();

  if (possibleTitles.length === 0) {
    console.error("❌ No hay títulos en titles.json");
    return "Título por defecto"; // Fallback en caso de error
  }

  let history = loadTitleHistory();
  let uniqueTitles = possibleTitles.filter((title) => !history.includes(title));

  if (uniqueTitles.length === 0) {
    uniqueTitles = [...possibleTitles];
  }

  return uniqueTitles[Math.floor(Math.random() * uniqueTitles.length)];
}

function markTitleUsed(title) {
  const possibleTitles = loadPossibleTitles();
  const history = loadTitleHistory();
  saveTitleHistory(nextTitleHistoryAfterMark(title, possibleTitles, history, MAX_HISTORY));
}

function setGitHubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

// 🔥 Función para obtener imágenes de Pexels
async function fetchPexelsImage(query) {
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
    const response = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
    });
    const data = await response.json();
    return data.photos?.[0]?.src?.medium || PLACEHOLDER_IMAGE;
  } catch (error) {
    console.error("❌ Error en Pexels API:", error);
    return PLACEHOLDER_IMAGE;
  }
}

// 🎨 Generar imagen para redes sociales
async function generateSocialImage(title, summary, imageUrl, slug) {
  const width = 800;
  const height = 420;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  try {
    // 🔥 Cargar la imagen de fondo
    const image = await loadImage(imageUrl);
    ctx.drawImage(image, 0, 0, width, height);

    // 🔳 Agregar overlay semi-transparente
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, height - 120, width, 120);

    // Configurar texto
    ctx.fillStyle = "white";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";

    // 🔹 Dividir el título en líneas si es muy largo
    const maxWidth = width - 40;
    const words = title.split(" ");
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const widthTest = ctx.measureText(currentLine + " " + word).width;
      if (widthTest < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    // Ajustar posición del título
    const lineHeight = 32;
    const titleY = height - 85 - (lines.length - 1) * lineHeight;

    lines.forEach((line, index) => {
      ctx.fillText(line, width / 2, titleY + index * lineHeight);
    });

    // Dibujar descripción
    ctx.font = "20px Arial";
    ctx.fillText(summary, width / 2, height - 30);

    // 📁 Guardar la imagen en `public/social_images/`
    const outputPath = path.join("public", "social_images", `${slug}.png`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const out = fs.createWriteStream(outputPath);
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on("finish", () => console.log(`✅ Imagen para redes generada: ${outputPath}`));
  } catch (error) {
    console.error("❌ Error al generar la imagen social:", error);
  }
}

async function generatePost() {
  const title = pickUniqueTitle();
  console.log(`✍️ Generando post sobre: ${title}...`);

  const prompt = `Genera un artículo en Markdown sobre: ${title}. Debe incluir:
  - Un título llamativo
  - Un resumen breve
  - Secciones bien estructuradas con subtítulos
  - Texto en español
  - Un bloque Front Matter YAML con: title, date, description, tags e image`;

  let content;
  try {
    content = await generateTextWithResilience(prompt);
  } catch (error) {
    if (error instanceof LlmSoftUnavailableError) {
      console.warn(`⚠️ ${error.message}`);
      console.warn("⚠️ Generación omitida por saturación del proveedor de IA (sin fallo del workflow).");
      return;
    }
    const message =
      error instanceof LlmUserFacingError
        ? error.message
        : "No se pudo generar el artículo. El servicio de IA no está disponible en este momento. Inténtalo de nuevo más tarde.";
    console.error(`❌ ${message}`);
    process.exitCode = 1;
    return;
  }
  const slug = title.toLowerCase().replace(/\s+/g, "-");

  console.log(`🖼 Buscando imagen para: ${title}...`);
  const imageUrl = await fetchPexelsImage(title);

  const frontMatter = `---
title: "${title}"
date: "${new Date().toISOString().split("T")[0]}"
description: "Artículo sobre ${title}"
tags: ["blog", "IA", "automatización"]
image: "${imageUrl}"
---\n\n`;

  const postPath = path.join("posts", `${slug}.md`);
  fs.writeFileSync(postPath, frontMatter + content, "utf8");
  markTitleUsed(title);
  setGitHubOutput("generated", "true");
  console.log(`✅ Post generado en: ${postPath}`);

  // 🔥 Generar imagen social
  await generateSocialImage(title, `Artículo sobre ${title}`, imageUrl, slug);

  console.log("🚀 Publicando en Twitter...");
  const blogUrl = process.env.SITE_URL; // Asegura que haya un valor por defecto
  const tweetText = `${title}\n\nArtículo nuevo en el blog 🚀\n\n🔗 Lee más: ${blogUrl}`; //Lee más: ${blogUrl}/posts/${slug}`;

  async function waitForFile(filePath, maxRetries = 10, delayMs = 500) {
    let retries = 0;
    while (!fs.existsSync(filePath) && retries < maxRetries) {
      console.log(`⏳ Esperando a que la imagen se genere... (${retries + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      retries++;
    }
    return fs.existsSync(filePath);
  }

  const imagePath = path.join("public", "social_images", `${slug}.png`);
  console.log(`📂 Verificando imagen en: ${imagePath}`);
  const fileExists = await waitForFile(imagePath);
  if (!fileExists) {
    console.error(`❌ Imagen no encontrada en ${imagePath}, abortando publicación.`);
    return;
  }

  await postToTwitter(tweetText, imagePath);
}

generatePost().catch((error) => {
  console.error(
    "❌ Error inesperado al generar el post. Inténtalo de nuevo más tarde.",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});





