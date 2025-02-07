import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const postsDirectory = path.join(process.cwd(), 'posts');

export function getSortedPosts() {
  const fileNames = fs.readdirSync(postsDirectory);

  const allPostsData = fileNames.map((fileName) => {
    const slug = fileName.replace(/\.md$/, '');
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, 'utf8');

    // Extraer los metadatos
    const { data, content } = matter(fileContents);

    // Verificar si los datos son correctos
    console.log(`📂 Cargando post: ${slug}`, data);

    // Asegurar que todos los posts tengan los datos necesarios
    if (!data.date || !data.title || !content) {
      console.warn(`⚠️ El post "${slug}" tiene datos incompletos.`);
      return null;
    }

    return {  
      slug,
      title: data.title,
      date: data.date,
      description: data.description || content.substring(0, 100) + "...", // Descripción o extracto
      image: data.image || "/placeholder.jpg", // Imagen por defecto si no tiene una
      content, // Se envía todo el contenido
    };
  });

  return allPostsData.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1));
}
