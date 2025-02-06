import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
function generateUniqueTitle() {
  const possibleTitles = [
    "Cuidados para perros en invierno",
    "Los mejores juguetes para gatos",
    "Cómo entrenar a tu cachorro",
    "Consejos para bañar a tu mascota",
    "Alimentación saludable para perros",
    "Cómo viajar con tu mascota de forma segura",
    "Los beneficios de adoptar un perro adulto",
    "Cómo socializar a un cachorro correctamente",
    "Juegos interactivos para estimular la mente de tu gato",
    "Errores comunes en la educación de perros",
  ];

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

async function generatePost() {
  const title = generateUniqueTitle();
  console.log(`✍️ Generando post sobre: ${title}...`);

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
  const slug = title.toLowerCase().replace(/\s+/g, "-");

  const frontMatter = `---\ntitle: "${title}"\ndate: "${new Date().toISOString().split("T")[0]}"\ndescription: "Artículo sobre ${title}"\ntags: ["blog", "IA", "automatización"]\n---\n\n`;
  
  const postPath = path.join("posts", `${slug}.md`);
  fs.writeFileSync(postPath, frontMatter + content, "utf8");
  console.log(`✅ Post generado en: ${postPath}`);
}

generatePost();
