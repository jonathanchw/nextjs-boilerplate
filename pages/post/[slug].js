import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import ReactMarkdown from 'react-markdown';

export async function getStaticPaths() {
  const postsDirectory = path.join(process.cwd(), 'posts');
  const filenames = fs.readdirSync(postsDirectory);

  const paths = filenames.map((filename) => ({
    params: { slug: filename.replace('.md', '') },
  }));

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const fullPath = path.join(process.cwd(), 'posts', `${params.slug}.md`);
  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = matter(fileContents);

  return {
    props: {
      title: data.title,
      date: data.date,
      content,
    },
  };
}

export default function PostPage({ title, date, content }) {
  return (
    <article>
      <h1>{title}</h1>
      <p>{date}</p>
      <ReactMarkdown>{content}</ReactMarkdown>
    </article>
  );
}
