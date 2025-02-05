import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generatePost(title) {
  console.log(`✍️ Generando post sobre: ${title}...`);

  // 1. Solicitar contenido a Gemini
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  const prompt = `Genera un artículo en formato Markdown sobre: ${title}. 
  El artículo debe incluir:
  - Un título llamativo
  - Un resumen breve
  - Secciones con subtítulos y contenido bien estructurado
  - Texto en español
  - Un bloque de Front Matter YAML al inicio con los campos: title, date, description y tags`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();

  // 2. Extraer título y generar slug
  const slug = title.toLowerCase().replace(/\s+/g, "-");

  // 3. Crear Front Matter automáticamente
  const frontMatter = `---
title: "${title}"
date: "${new Date().toISOString().split("T")[0]}"
description: "Artículo sobre ${title}"
tags: ["blog", "IA", "automatización"]
---\n\n`;

  // 4. Guardar el archivo .md en la carpeta correcta
  const postPath = path.join("posts", `${slug}.md`);
  fs.writeFileSync(postPath, frontMatter + content, "utf8");

  console.log(`✅ Post generado en: ${postPath}`);
}

// Ejecutar el script con un argumento
const postTitle = process.argv[2];
if (!postTitle) {
  console.error("❌ Debes ingresar un título para el post.");
  process.exit(1);
}

generatePost(postTitle);
