import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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

// Generar un título aleatorio sin repetición
function generateUniqueTitle() {
  const possibleTitles = loadPossibleTitles();

  if (possibleTitles.length === 0) {
    console.error("❌ No hay títulos en titles.json");
    return "Título por defecto"; // Fallback en caso de error
  }

  let history = loadTitleHistory();
  let uniqueTitles = possibleTitles.filter(title => !history.includes(title));

  if (uniqueTitles.length === 0) {
    history = [];
    uniqueTitles = [...possibleTitles];
  }

  const newTitle = uniqueTitles[Math.floor(Math.random() * uniqueTitles.length)];
  history.push(newTitle);
  saveTitleHistory(history);

  return newTitle;
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

async function generatePost() {
  const title = generateUniqueTitle();
  console.log(`✍️ Generando post sobre: ${title}...`);

  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  const prompt = `Genera un artículo en Markdown sobre: ${title}. Debe incluir:
  - Un título llamativo
  - Un resumen breve
  - Secciones bien estructuradas con subtítulos
  - Texto en español
  - Un bloque Front Matter YAML con: title, date, description, tags e image`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();
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
  console.log(`✅ Post generado en: ${postPath}`);
}

generatePost();