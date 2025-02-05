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
    console.log(`📂 Cargando post: ${slug}`, data, content);

    // Asegurar que todos los posts tengan fecha y título
    if (!data.date || !data.title || !data.content) {
      console.warn(`⚠️ El post "${slug}" no tiene fecha o título o content válido.`);
      return null;
    }

    return {  slug,
      title: data.title,
      date: data.date,
      excerpt: content.substring(0, 100) + "...", // Muestra un pequeño resumen
     };
  });

  return allPostsData.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1));
}

