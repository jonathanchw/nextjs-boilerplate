import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import ReactMarkdown from 'react-markdown';

// Función para leer los posts en el servidor
function getSortedPosts() {
  const postsDirectory = path.join(process.cwd(), "posts");
  const fileNames = fs.readdirSync(postsDirectory);

  return fileNames
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, "");
      const fullPath = path.join(postsDirectory, fileName);
      const fileContents = fs.readFileSync(fullPath, "utf8");
      const { data, content } = matter(fileContents);

      return {
        slug,
        content,
        title: data.title || "Sin título",
        date: data.date || "1970-01-01", // Fecha predeterminada si falta
      };
    })
    .sort((a, b) => (a.date > b.date ? -1 : 1)); // Orden descendente
}


export default function Home() {
  const posts = getSortedPosts();

  return (
    <main className="max-w-3xl mx-auto py-10">
      <h1 className="text-3xl font-bold text-center mb-6">🐶 Blog de Mascotas</h1>
      {posts.map(({ slug, title, date, content }) => (
        <article key={slug} className="bg-white shadow-md p-6 rounded-xl mb-6">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-gray-500 text-sm">{date}</p>
          <div className="prose mt-4">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </article>
      ))}
    </main>
  );
}
